use std::collections::HashMap;
use std::collections::HashSet;
use std::collections::hash_map::Entry;

use crate::EMBEDDED_SOURCES;
use crate::model::{Certification, ContentBundle, Domain, Question, Task};
use crate::validate::{ContentError, validate};

/// An immutable set of validated content bundles.
///
/// Bundles that declare the same certification version are merged into one
/// logical bundle, so a certification's content can be split across files (for
/// example one file per exam domain) without a code change.
#[derive(Debug, Clone)]
pub struct ContentRegistry {
    bundles: Vec<ContentBundle>,
}

impl ContentRegistry {
    /// Loads and validates every content bundle discovered at build time.
    ///
    /// Content is organized as `<category>/<certification>/<version>/<file>.json`
    /// under `content/`; adding or splitting content requires no code change.
    pub fn embedded() -> Result<Self, Vec<ContentError>> {
        if EMBEDDED_SOURCES.is_empty() {
            return Err(vec![ContentError {
                code: "no_content",
                message: "no content bundles were embedded".to_owned(),
            }]);
        }

        Self::from_json(EMBEDDED_SOURCES)
    }

    /// Parses, validates, and merges one or more JSON bundle sources.
    ///
    /// Each source must independently be a valid bundle. Sources that share a
    /// certification id and version id are then merged: concepts and questions
    /// are keyed by id (later sources override earlier ones), and domains are
    /// merged by task id (later definitions override earlier ones). This lets a
    /// task be expanded or rewritten by a newer file without duplicating it.
    pub fn from_json(sources: &[&str]) -> Result<Self, Vec<ContentError>> {
        let mut parsed = Vec::new();
        let mut errors = Vec::new();

        for source in sources {
            match serde_json::from_str::<ContentBundle>(source) {
                Ok(bundle) => match validate(&bundle) {
                    Ok(()) => parsed.push(bundle),
                    Err(mut found) => errors.append(&mut found),
                },
                Err(error) => errors.push(ContentError {
                    code: "invalid_json",
                    message: error.to_string(),
                }),
            }
        }

        if !errors.is_empty() {
            return Err(errors);
        }

        // Group by certification version, preserving first-seen order.
        let mut order: Vec<(String, String)> = Vec::new();
        let mut groups: HashMap<(String, String), Vec<ContentBundle>> = HashMap::new();
        for bundle in parsed {
            let key = (bundle.certification.id.clone(), bundle.version.id.clone());
            if !groups.contains_key(&key) {
                order.push(key.clone());
            }
            groups.entry(key).or_default().push(bundle);
        }

        let mut bundles = Vec::new();
        for key in order {
            if let Some(group) = groups.remove(&key) {
                match merge_group(group) {
                    Ok(merged) => bundles.push(merged),
                    Err(mut found) => errors.append(&mut found),
                }
            }
        }

        if errors.is_empty() {
            Ok(Self { bundles })
        } else {
            Err(errors)
        }
    }

    /// All certification identities.
    pub fn certifications(&self) -> impl Iterator<Item = &Certification> {
        self.bundles.iter().map(|bundle| &bundle.certification)
    }

    /// All bundles.
    pub fn bundles(&self) -> &[ContentBundle] {
        &self.bundles
    }

    /// Finds a bundle by certification id.
    pub fn bundle_for_certification(&self, certification_id: &str) -> Option<&ContentBundle> {
        self.bundles
            .iter()
            .find(|bundle| bundle.certification.id == certification_id)
    }

    /// Finds a bundle by certification version id.
    pub fn bundle_for_version(&self, certification_version: &str) -> Option<&ContentBundle> {
        self.bundles
            .iter()
            .find(|bundle| bundle.version.id == certification_version)
    }

    /// Finds a domain and task within a certification version.
    pub fn find_task(
        &self,
        certification_version: &str,
        task_id: &str,
    ) -> Option<(&Domain, &Task)> {
        let bundle = self.bundle_for_version(certification_version)?;
        for domain in &bundle.version.domains {
            for task in &domain.tasks {
                if task.id == task_id {
                    return Some((domain, task));
                }
            }
        }
        None
    }

    /// Returns the questions for a task, in authored presentation order.
    pub fn questions_for_task(&self, certification_version: &str, task_id: &str) -> Vec<&Question> {
        let Some(bundle) = self.bundle_for_version(certification_version) else {
            return Vec::new();
        };
        let Some((_, task)) = self.find_task(certification_version, task_id) else {
            return Vec::new();
        };

        task.question_ids
            .iter()
            .filter_map(|question_id| {
                bundle
                    .questions
                    .iter()
                    .find(|question| &question.id == question_id)
            })
            .collect()
    }

    /// Finds a question by certification version and question id.
    pub fn question(&self, certification_version: &str, question_id: &str) -> Option<&Question> {
        self.bundle_for_version(certification_version)?
            .questions
            .iter()
            .find(|question| question.id == question_id)
    }

    /// Returns every authored question for a version, in authored domain/task
    /// order and without duplicates.
    pub fn questions_for_version<'a>(&'a self, certification_version: &str) -> Vec<&'a Question> {
        let Some(bundle) = self.bundle_for_version(certification_version) else {
            return Vec::new();
        };
        questions_in_order(bundle)
    }

    /// Returns every authored question for one domain, in authored order.
    pub fn questions_for_domain<'a>(
        &'a self,
        certification_version: &str,
        domain_id: &str,
    ) -> Vec<&'a Question> {
        let Some(bundle) = self.bundle_for_version(certification_version) else {
            return Vec::new();
        };
        let mut questions = Vec::new();
        let mut seen = HashSet::new();
        for domain in bundle
            .version
            .domains
            .iter()
            .filter(|domain| domain.id == domain_id)
        {
            collect_task_questions(bundle, domain, &mut seen, &mut questions);
        }
        questions
    }
}

fn questions_in_order(bundle: &ContentBundle) -> Vec<&Question> {
    let mut questions = Vec::new();
    let mut seen = HashSet::new();
    for domain in &bundle.version.domains {
        collect_task_questions(bundle, domain, &mut seen, &mut questions);
    }
    questions
}

fn collect_task_questions<'a>(
    bundle: &'a ContentBundle,
    domain: &'a Domain,
    seen: &mut HashSet<&'a str>,
    questions: &mut Vec<&'a Question>,
) {
    for task in &domain.tasks {
        for question_id in &task.question_ids {
            if !seen.insert(question_id.as_str()) {
                continue;
            }
            if let Some(question) = bundle
                .questions
                .iter()
                .find(|question| &question.id == question_id)
            {
                questions.push(question);
            }
        }
    }
}

/// Merges bundles that declare the same certification version into one bundle.
fn merge_group(group: Vec<ContentBundle>) -> Result<ContentBundle, Vec<ContentError>> {
    let mut iter = group.into_iter();
    let Some(base) = iter.next() else {
        return Err(vec![ContentError {
            code: "empty_content_group",
            message: "content group has no bundles".to_owned(),
        }]);
    };

    let ContentBundle {
        certification,
        version: base_version,
        concepts: base_concepts,
        questions: base_questions,
    } = base;

    let mut version = base_version;
    let mut domains = std::mem::take(&mut version.domains);
    let mut domain_index: HashMap<String, usize> = domains
        .iter()
        .enumerate()
        .map(|(index, domain)| (domain.id.clone(), index))
        .collect();

    let mut concepts = base_concepts;
    let mut question_order: Vec<String> = base_questions
        .iter()
        .map(|question| question.id.clone())
        .collect();
    let mut questions: HashMap<String, Question> = base_questions
        .into_iter()
        .map(|question| (question.id.clone(), question))
        .collect();

    for bundle in iter {
        for concept in bundle.concepts {
            match concepts
                .iter()
                .position(|existing| existing.id == concept.id)
            {
                Some(index) => concepts[index] = concept,
                None => concepts.push(concept),
            }
        }

        for question in bundle.questions {
            match questions.entry(question.id.clone()) {
                Entry::Vacant(slot) => {
                    question_order.push(question.id.clone());
                    slot.insert(question);
                }
                Entry::Occupied(mut slot) => {
                    slot.insert(question);
                }
            }
        }

        for domain in bundle.version.domains {
            match domain_index.get(&domain.id) {
                Some(&index) => {
                    let existing = &mut domains[index];
                    for task in domain.tasks {
                        match existing.tasks.iter().position(|entry| entry.id == task.id) {
                            Some(task_index) => existing.tasks[task_index] = task,
                            None => existing.tasks.push(task),
                        }
                    }
                }
                None => {
                    domain_index.insert(domain.id.clone(), domains.len());
                    domains.push(domain);
                }
            }
        }
    }

    version.domains = domains;

    let merged = ContentBundle {
        certification,
        version,
        concepts,
        questions: question_order
            .into_iter()
            .filter_map(|question_id| questions.remove(&question_id))
            .collect(),
    };

    let mut errors = Vec::new();
    validate_task_content_versions(&merged, &mut errors);
    if errors.is_empty() {
        Ok(merged)
    } else {
        Err(errors)
    }
}

/// Ensures every task maps to questions from a single content version.
///
/// A mission is issued against one content version, so a task that spans
/// versions could not be scored consistently. Different files may still use
/// different content versions as long as each task is internally consistent.
fn validate_task_content_versions(bundle: &ContentBundle, errors: &mut Vec<ContentError>) {
    let by_id: HashMap<&str, &Question> = bundle
        .questions
        .iter()
        .map(|question| (question.id.as_str(), question))
        .collect();

    for domain in &bundle.version.domains {
        for task in &domain.tasks {
            let mut content_version: Option<&str> = None;
            let mut mixed = false;
            for question_id in &task.question_ids {
                let Some(question) = by_id.get(question_id.as_str()) else {
                    continue;
                };
                match content_version {
                    None => content_version = Some(question.content_version.as_str()),
                    Some(current) if current != question.content_version.as_str() => {
                        mixed = true;
                        break;
                    }
                    Some(_) => {}
                }
            }
            if mixed {
                errors.push(ContentError {
                    code: "task_content_version_mixed",
                    message: format!(
                        "task {} spans multiple content versions; a mission must use one",
                        task.id
                    ),
                });
            }
        }
    }
}
