use std::collections::HashMap;
use std::collections::HashSet;
use std::collections::hash_map::Entry;

use crate::challenge::{ChallengeDefinition, validate_challenge};
use crate::learning::{KnowledgeNode, LearningDomain, LearningModule, validate_learning_domain};
use crate::model::{Certification, ContentBundle, Domain, Question, Task};
use crate::practice_test::{PracticeTest, validate_practice_test};
use crate::validate::{ContentError, validate};
use crate::{
    EMBEDDED_CHALLENGE_SOURCES, EMBEDDED_LEARNING_SOURCES, EMBEDDED_PRACTICE_TEST_SOURCES,
    EMBEDDED_SOURCES, EmbeddedSource,
};

/// A raw content source plus the file it came from, when known.
struct SourceRef<'a> {
    path: Option<&'a str>,
    json: &'a str,
}

/// An immutable set of validated content bundles, learning domains, and
/// practice tests.
///
/// Quiz bundles that declare the same certification version are merged into one
/// logical bundle, so a certification's content can be split across files (for
/// example one file per exam domain) without a code change. Learning knowledge
/// maps and practice tests are distinct content types and are kept separate.
#[derive(Debug, Clone)]
pub struct ContentRegistry {
    bundles: Vec<ContentBundle>,
    learning_domains: Vec<LearningDomain>,
    practice_tests: Vec<PracticeTest>,
    challenges: Vec<ChallengeDefinition>,
}

impl ContentRegistry {
    /// Loads and validates every content source discovered at build time.
    ///
    /// Quiz content is organized as
    /// `<category>/<certification>/<version>/<file>.json` and learning content
    /// as `.../learning/<file>.json` under `content/`; adding or splitting
    /// content requires no code change.
    ///
    /// This is strict: any invalid source fails the load. Use
    /// [`ContentRegistry::embedded_lenient`] when a single bad authoring file
    /// must not take the service down.
    pub fn embedded() -> Result<Self, Vec<ContentError>> {
        if EMBEDDED_SOURCES.is_empty() {
            return Err(vec![ContentError::new(
                "no_content",
                "no content bundles were embedded",
            )]);
        }

        let quiz = embedded_refs(EMBEDDED_SOURCES);
        let learning = embedded_refs(EMBEDDED_LEARNING_SOURCES);
        let practice = embedded_refs(EMBEDDED_PRACTICE_TEST_SOURCES);
        let challenges = embedded_refs(EMBEDDED_CHALLENGE_SOURCES);
        Self::from_source_refs(&quiz, &learning, &practice, &challenges)
    }

    /// Loads embedded content without failing on individual malformed files.
    ///
    /// Returns the valid subset together with every error found, each naming
    /// the file it came from. A file that fails to parse or validate is skipped
    /// so one bad authoring file cannot take the API offline. Strict validation
    /// stays available through [`ContentRegistry::embedded`] and the test suite.
    pub fn embedded_lenient() -> (Self, Vec<ContentError>) {
        let quiz = embedded_refs(EMBEDDED_SOURCES);
        let learning = embedded_refs(EMBEDDED_LEARNING_SOURCES);
        let practice = embedded_refs(EMBEDDED_PRACTICE_TEST_SOURCES);
        let challenges = embedded_refs(EMBEDDED_CHALLENGE_SOURCES);
        let assembled = assemble(&quiz, &learning, &practice, &challenges);
        (
            Self {
                bundles: assembled.bundles,
                learning_domains: assembled.learning_domains,
                practice_tests: assembled.practice_tests,
                challenges: assembled.challenges,
            },
            assembled.errors,
        )
    }

    /// Parses, validates, and merges quiz bundle sources only.
    pub fn from_json(sources: &[&str]) -> Result<Self, Vec<ContentError>> {
        Self::from_sources(sources, &[])
    }

    /// Parses, validates, and merges quiz and learning sources.
    ///
    /// Each source must independently be valid. Quiz sources that share a
    /// certification id and version id are merged: concepts and questions are
    /// keyed by id (later sources override earlier ones), and domains are merged
    /// by task id (later definitions override earlier ones). Learning domains
    /// are validated on their own and cross-checked against the quiz bundle for
    /// the same certification version.
    pub fn from_sources(
        sources: &[&str],
        learning_sources: &[&str],
    ) -> Result<Self, Vec<ContentError>> {
        Self::from_all_sources(sources, learning_sources, &[])
    }

    /// Parses, validates, and merges quiz, learning, and practice-test sources.
    pub fn from_all_sources(
        sources: &[&str],
        learning_sources: &[&str],
        practice_test_sources: &[&str],
    ) -> Result<Self, Vec<ContentError>> {
        Self::from_all_sources_with_challenges(
            sources,
            learning_sources,
            practice_test_sources,
            &[],
        )
    }

    /// Parses, validates, and merges quiz, learning, practice-test, and
    /// challenge sources.
    pub fn from_all_sources_with_challenges(
        sources: &[&str],
        learning_sources: &[&str],
        practice_test_sources: &[&str],
        challenge_sources: &[&str],
    ) -> Result<Self, Vec<ContentError>> {
        let quiz = inline_refs(sources);
        let learning = inline_refs(learning_sources);
        let practice = inline_refs(practice_test_sources);
        let challenges = inline_refs(challenge_sources);
        Self::from_source_refs(&quiz, &learning, &practice, &challenges)
    }

    fn from_source_refs(
        sources: &[SourceRef<'_>],
        learning_sources: &[SourceRef<'_>],
        practice_test_sources: &[SourceRef<'_>],
        challenge_sources: &[SourceRef<'_>],
    ) -> Result<Self, Vec<ContentError>> {
        let assembled = assemble(
            sources,
            learning_sources,
            practice_test_sources,
            challenge_sources,
        );

        if assembled.errors.is_empty() {
            Ok(Self {
                bundles: assembled.bundles,
                learning_domains: assembled.learning_domains,
                practice_tests: assembled.practice_tests,
                challenges: assembled.challenges,
            })
        } else {
            Err(assembled.errors)
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

    /// All validated practice tests.
    pub fn practice_tests(&self) -> &[PracticeTest] {
        &self.practice_tests
    }

    /// Finds a practice test by its stable id.
    pub fn practice_test(&self, practice_test_id: &str) -> Option<&PracticeTest> {
        self.practice_tests
            .iter()
            .find(|test| test.id == practice_test_id)
    }

    /// Practice tests for a certification version, in embedded order.
    ///
    /// A practice test is keyed by certification version (`soa-c03`).
    pub fn practice_tests_for_version(&self, certification_version: &str) -> Vec<&PracticeTest> {
        self.practice_tests
            .iter()
            .filter(|test| test.certification_version == certification_version)
            .collect()
    }

    /// Practice tests for a certification id (`aws-soa-c03`).
    ///
    /// Resolves the certification to its versions so callers can address tests
    /// by the same certification id used elsewhere in the API.
    pub fn practice_tests_for_certification(&self, certification_id: &str) -> Vec<&PracticeTest> {
        let versions: HashSet<&str> = self
            .bundles
            .iter()
            .filter(|bundle| bundle.certification.id == certification_id)
            .map(|bundle| bundle.version.id.as_str())
            .collect();
        if versions.is_empty() {
            return Vec::new();
        }
        self.practice_tests
            .iter()
            .filter(|test| versions.contains(test.certification_version.as_str()))
            .collect()
    }

    /// All validated challenges.
    pub fn challenges(&self) -> &[ChallengeDefinition] {
        &self.challenges
    }

    /// Challenges for a certification, in embedded order.
    pub fn challenges_for_certification(
        &self,
        certification_id: &str,
    ) -> Vec<&ChallengeDefinition> {
        self.challenges
            .iter()
            .filter(|challenge| challenge.certification_id == certification_id)
            .collect()
    }

    /// Finds a challenge by certification id and challenge id.
    ///
    /// Challenge ids are unique within a track version; a certification exposes
    /// one active version, so the certification id is sufficient to address it.
    pub fn challenge(
        &self,
        certification_id: &str,
        challenge_id: &str,
    ) -> Option<&ChallengeDefinition> {
        self.challenges.iter().find(|challenge| {
            challenge.certification_id == certification_id && challenge.id == challenge_id
        })
    }

    /// Finds the domain that owns a knowledge node, if any.
    ///
    /// Used to resolve a learning-node challenge stage to the domain the
    /// Knowledge Map needs to render it.
    pub fn node_domain_id(&self, certification_version: &str, node_id: &str) -> Option<&str> {
        self.learning_domains
            .iter()
            .filter(|domain| domain.certification_version == certification_version)
            .find(|domain| domain.node(node_id).is_some())
            .map(|domain| domain.domain.id.as_str())
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

    /// Returns every authored question for one learning module (section), in
    /// authored task order and without duplicates.
    ///
    /// A module declares the exam tasks it teaches via `task_ids`; its question
    /// pool is the union of those tasks' authored questions. When a module
    /// declares no tasks (authorship gap), questions are matched by the
    /// knowledge nodes' concepts instead, so a section quiz is still possible.
    /// Returns empty when the module or its learning domain is unknown.
    pub fn questions_for_module<'a>(
        &'a self,
        certification_version: &str,
        domain_id: &str,
        module_id: &str,
    ) -> Vec<&'a Question> {
        let Some(module) = self
            .learning_modules(certification_version, domain_id)
            .and_then(|modules| modules.iter().find(|module| module.id == module_id))
        else {
            return Vec::new();
        };
        let Some(bundle) = self.bundle_for_version(certification_version) else {
            return Vec::new();
        };

        let mut questions = Vec::new();
        let mut seen = HashSet::new();

        for task_id in &module.task_ids {
            let Some((_, task)) = self.find_task(certification_version, task_id) else {
                continue;
            };
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

        // Authorship fallback: a module with no declared tasks still maps to
        // concepts through its nodes, so match questions on concept overlap.
        if questions.is_empty() {
            let concept_ids: HashSet<&str> = module
                .nodes
                .iter()
                .flat_map(|node| node.concept_ids.iter().map(String::as_str))
                .collect();
            if !concept_ids.is_empty() {
                for question in &bundle.questions {
                    if question
                        .concepts
                        .iter()
                        .any(|concept| concept_ids.contains(concept.concept_id.as_str()))
                    {
                        questions.push(question);
                    }
                }
            }
        }

        questions
    }

    /// All validated learning domains.
    pub fn learning_domains(&self) -> &[LearningDomain] {
        &self.learning_domains
    }

    /// Finds a learning domain by certification version and domain id.
    pub fn learning_domain(
        &self,
        certification_version: &str,
        domain_id: &str,
    ) -> Option<&LearningDomain> {
        self.learning_domains.iter().find(|domain| {
            domain.certification_version == certification_version && domain.domain.id == domain_id
        })
    }

    /// Finds a learning domain by certification id and domain id.
    ///
    /// The learning API is addressed by certification id, not version; a
    /// certification currently exposes one active version.
    pub fn learning_domain_for_certification(
        &self,
        certification_id: &str,
        domain_id: &str,
    ) -> Option<&LearningDomain> {
        self.learning_domains.iter().find(|domain| {
            domain.certification_id == certification_id && domain.domain.id == domain_id
        })
    }

    /// Whether learner-facing learning content exists for a domain.
    pub fn learning_available(&self, certification_id: &str, domain_id: &str) -> bool {
        self.learning_domain_for_certification(certification_id, domain_id)
            .is_some()
    }

    /// Returns the modules of a learning domain in authored order.
    pub fn learning_modules(
        &self,
        certification_version: &str,
        domain_id: &str,
    ) -> Option<&[LearningModule]> {
        self.learning_domain(certification_version, domain_id)
            .map(|domain| domain.modules.as_slice())
    }

    /// Finds one knowledge node within a learning domain.
    pub fn learning_node(
        &self,
        certification_version: &str,
        domain_id: &str,
        node_id: &str,
    ) -> Option<&KnowledgeNode> {
        self.learning_domain(certification_version, domain_id)?
            .node(node_id)
    }
}

/// Borrows embedded sources, keeping their repository-relative paths.
fn embedded_refs(sources: &[EmbeddedSource]) -> Vec<SourceRef<'_>> {
    sources
        .iter()
        .map(|source| SourceRef {
            path: Some(source.path),
            json: source.json,
        })
        .collect()
}

/// Borrows in-memory sources that have no file path.
fn inline_refs<'a>(sources: &'a [&'a str]) -> Vec<SourceRef<'a>> {
    sources
        .iter()
        .map(|json| SourceRef { path: None, json })
        .collect()
}

/// The valid subset parsed from every source, plus every error found.
struct AssembledContent {
    bundles: Vec<ContentBundle>,
    learning_domains: Vec<LearningDomain>,
    practice_tests: Vec<PracticeTest>,
    challenges: Vec<ChallengeDefinition>,
    errors: Vec<ContentError>,
}

/// Parses, validates, and cross-checks sources, collecting every error.
///
/// Invalid sources are skipped rather than aborting, so the returned bundles
/// and learning domains are the valid subset.
fn assemble(
    sources: &[SourceRef<'_>],
    learning_sources: &[SourceRef<'_>],
    practice_test_sources: &[SourceRef<'_>],
    challenge_sources: &[SourceRef<'_>],
) -> AssembledContent {
    let mut errors = Vec::new();
    let bundles = parse_bundles(sources, &mut errors);
    let learning_domains = parse_learning_domains(learning_sources, &mut errors);
    let practice_tests = parse_practice_tests(practice_test_sources, &mut errors);
    let challenges = parse_challenges(challenge_sources, &mut errors);

    for domain in &learning_domains {
        validate_learning_against_bundles(domain, &bundles, &mut errors);
    }
    validate_unique_learning_domains(&learning_domains, &mut errors);
    validate_unique_practice_tests(&practice_tests, &mut errors);
    validate_remediation_nodes_against_learning(&bundles, &learning_domains, &mut errors);
    validate_unique_challenges(&challenges, &mut errors);
    validate_challenges_against_content(&challenges, &bundles, &learning_domains, &mut errors);

    for test in &practice_tests {
        validate_practice_test_against_bundles(test, &bundles, &mut errors);
    }

    AssembledContent {
        bundles,
        learning_domains,
        practice_tests,
        challenges,
        errors,
    }
}

/// Fills in the source file for errors that do not already name one.
fn attribute(errors: &mut [ContentError], path: Option<&str>) {
    let Some(path) = path else {
        return;
    };
    for error in errors.iter_mut() {
        if error.source.is_none() {
            error.source = Some(path.to_owned());
        }
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
        return Err(vec![ContentError::new(
            "empty_content_group",
            "content group has no bundles",
        )]);
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
                errors.push(ContentError::new(
                    "task_content_version_mixed",
                    format!(
                        "task {} spans multiple content versions; a mission must use one",
                        task.id
                    ),
                ));
            }
        }
    }
}

/// Parses and merges quiz bundle sources, recording every error found.
fn parse_bundles(sources: &[SourceRef<'_>], errors: &mut Vec<ContentError>) -> Vec<ContentBundle> {
    let mut parsed = Vec::new();

    for source in sources {
        match serde_json::from_str::<ContentBundle>(source.json) {
            Ok(bundle) => match validate(&bundle) {
                Ok(()) => parsed.push(bundle),
                Err(mut found) => {
                    attribute(&mut found, source.path);
                    errors.append(&mut found);
                }
            },
            Err(error) => {
                let error = ContentError::new("invalid_json", error.to_string());
                errors.push(match source.path {
                    Some(path) => error.with_source(path),
                    None => error,
                });
            }
        }
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

    bundles
}

/// Parses and validates learning domain sources, recording every error found.
fn parse_learning_domains(
    sources: &[SourceRef<'_>],
    errors: &mut Vec<ContentError>,
) -> Vec<LearningDomain> {
    let mut domains = Vec::new();

    for source in sources {
        match serde_json::from_str::<LearningDomain>(source.json) {
            Ok(domain) => match validate_learning_domain(&domain) {
                Ok(()) => domains.push(domain),
                Err(mut found) => {
                    attribute(&mut found, source.path);
                    errors.append(&mut found);
                }
            },
            Err(error) => {
                let error = ContentError::new("invalid_learning_json", error.to_string());
                errors.push(match source.path {
                    Some(path) => error.with_source(path),
                    None => error,
                });
            }
        }
    }

    domains
}

/// Parses and validates practice-test sources, recording every error found.
fn parse_practice_tests(
    sources: &[SourceRef<'_>],
    errors: &mut Vec<ContentError>,
) -> Vec<PracticeTest> {
    let mut tests = Vec::new();

    for source in sources {
        match serde_json::from_str::<PracticeTest>(source.json) {
            Ok(test) => match validate_practice_test(&test) {
                Ok(()) => tests.push(test),
                Err(mut found) => {
                    attribute(&mut found, source.path);
                    errors.append(&mut found);
                }
            },
            Err(error) => {
                let error = ContentError::new("invalid_practice_test_json", error.to_string());
                errors.push(match source.path {
                    Some(path) => error.with_source(path),
                    None => error,
                });
            }
        }
    }

    tests
}

/// Parses and validates challenge sources, recording every error found.
fn parse_challenges(
    sources: &[SourceRef<'_>],
    errors: &mut Vec<ContentError>,
) -> Vec<ChallengeDefinition> {
    let mut challenges = Vec::new();

    for source in sources {
        match serde_json::from_str::<ChallengeDefinition>(source.json) {
            Ok(challenge) => match validate_challenge(&challenge) {
                Ok(()) => challenges.push(challenge),
                Err(mut found) => {
                    attribute(&mut found, source.path);
                    errors.append(&mut found);
                }
            },
            Err(error) => {
                let error = ContentError::new("invalid_challenge_json", error.to_string());
                errors.push(match source.path {
                    Some(path) => error.with_source(path),
                    None => error,
                });
            }
        }
    }

    challenges
}

/// Rejects two challenges claiming the same id within a track version.
fn validate_unique_challenges(challenges: &[ChallengeDefinition], errors: &mut Vec<ContentError>) {
    let mut seen = HashSet::new();
    for challenge in challenges {
        let key = (
            challenge.certification_id.as_str(),
            challenge.certification_version.as_str(),
            challenge.id.as_str(),
        );
        if !seen.insert(key) {
            errors.push(ContentError::new(
                "duplicate_challenge_id",
                format!(
                    "duplicate challenge id {} for certification version {}",
                    challenge.id, challenge.certification_version
                ),
            ));
        }
    }
}

/// Cross-checks a challenge's references against quiz and learning content.
///
/// A challenge references existing content by stable id. Every question must
/// resolve in the bundle for the same track/version, every node (and every
/// prerequisite node) must resolve in the learning map, and any referenced
/// question's authored `challenge_group_id` must match the challenge id so the
/// authored grouping stays consistent.
fn validate_challenges_against_content(
    challenges: &[ChallengeDefinition],
    bundles: &[ContentBundle],
    learning_domains: &[LearningDomain],
    errors: &mut Vec<ContentError>,
) {
    for challenge in challenges {
        let Some(bundle) = bundles.iter().find(|bundle| {
            bundle.certification.id == challenge.certification_id
                && bundle.version.id == challenge.certification_version
        }) else {
            errors.push(ContentError::new(
                "challenge_unknown_track",
                format!(
                    "challenge {} references unknown certification version {} for {}",
                    challenge.id, challenge.certification_version, challenge.certification_id
                ),
            ));
            continue;
        };

        if let Some(domain_id) = challenge.domain_id.as_deref() {
            if !bundle
                .version
                .domains
                .iter()
                .any(|domain| domain.id == domain_id)
            {
                errors.push(ContentError::new(
                    "challenge_unknown_domain",
                    format!(
                        "challenge {} references unknown domain {}",
                        challenge.id, domain_id
                    ),
                ));
            }
        }

        let version_domains: Vec<&LearningDomain> = learning_domains
            .iter()
            .filter(|domain| {
                domain.certification_id == challenge.certification_id
                    && domain.certification_version == challenge.certification_version
            })
            .collect();
        let node_exists = |node_id: &str| {
            version_domains
                .iter()
                .any(|domain| domain.node(node_id).is_some())
        };

        for node_id in &challenge.prerequisite_node_ids {
            if !node_exists(node_id) {
                errors.push(ContentError::new(
                    "challenge_unknown_prerequisite_node",
                    format!(
                        "challenge {} references unknown prerequisite node {}",
                        challenge.id, node_id
                    ),
                ));
            }
        }

        for stage in &challenge.stages {
            if let Some(question_id) = stage.question_id() {
                let Some(question) = bundle
                    .questions
                    .iter()
                    .find(|question| question.id == question_id)
                else {
                    errors.push(ContentError::new(
                        "challenge_unknown_question",
                        format!(
                            "challenge {} stage {} references unknown question {}",
                            challenge.id,
                            stage.id(),
                            question_id
                        ),
                    ));
                    continue;
                };
                if let Some(group) = question
                    .pedagogy
                    .as_ref()
                    .and_then(|pedagogy| pedagogy.challenge_group_id.as_deref())
                {
                    if group != challenge.id {
                        errors.push(ContentError::new(
                            "challenge_group_mismatch",
                            format!(
                                "challenge {} stage {} references question {} authored for challenge group {}",
                                challenge.id,
                                stage.id(),
                                question_id,
                                group
                            ),
                        ));
                    }
                }
            }

            if let Some(node_id) = stage.node_id() {
                if !node_exists(node_id) {
                    errors.push(ContentError::new(
                        "challenge_unknown_node",
                        format!(
                            "challenge {} stage {} references unknown node {}",
                            challenge.id,
                            stage.id(),
                            node_id
                        ),
                    ));
                }
            }
        }
    }
}

/// Rejects two practice tests claiming the same id.
fn validate_unique_practice_tests(tests: &[PracticeTest], errors: &mut Vec<ContentError>) {
    let mut seen = HashSet::new();
    for test in tests {
        if !seen.insert(test.id.as_str()) {
            errors.push(ContentError::new(
                "duplicate_practice_test_id",
                format!("duplicate practice test id {}", test.id),
            ));
        }
    }
}

/// Cross-checks a practice test against the quiz bundle for its version.
///
/// Practice tests never load as bundles, but they share a certification version
/// and domain ids. When no bundle exists yet the cross-check is skipped so a
/// practice test can be authored ahead of its quiz content.
fn validate_practice_test_against_bundles(
    test: &PracticeTest,
    bundles: &[ContentBundle],
    errors: &mut Vec<ContentError>,
) {
    let Some(bundle) = bundles
        .iter()
        .find(|bundle| bundle.version.id == test.certification_version)
    else {
        return;
    };

    if !bundle
        .certification
        .exam_code
        .eq_ignore_ascii_case(&test.exam_code)
    {
        errors.push(ContentError::new(
            "practice_test_exam_code_mismatch",
            format!(
                "practice test {} exam_code {} does not match certification exam code {}",
                test.id, test.exam_code, bundle.certification.exam_code
            ),
        ));
    }

    let domain_ids: HashSet<&str> = bundle
        .version
        .domains
        .iter()
        .map(|domain| domain.id.as_str())
        .collect();
    for item in &test.items {
        if !domain_ids.contains(item.question.domain_id.as_str()) {
            errors.push(ContentError::new(
                "practice_test_unknown_domain",
                format!(
                    "practice test {} question {} references unknown domain {}",
                    test.id, item.question.id, item.question.domain_id
                ),
            ));
        }
    }
}

/// Cross-checks remediation `node_id` targets against the learning map.
///
/// A question's remediation node must resolve somewhere in the same
/// certification version. The check is skipped when no learning content exists
/// for that version, so a quiz bundle can be authored ahead of its knowledge
/// map without becoming invalid. Node ids are only unique within a track
/// version, so the search is scoped by `(certification_id, certification_version)`.
fn validate_remediation_nodes_against_learning(
    bundles: &[ContentBundle],
    learning_domains: &[LearningDomain],
    errors: &mut Vec<ContentError>,
) {
    // Index every node id by (certification, version) once, so each question's
    // remediation reference is an O(1) lookup instead of scanning all nodes.
    let mut nodes_by_version: HashMap<(&str, &str), HashSet<&str>> = HashMap::new();
    for domain in learning_domains {
        let nodes = nodes_by_version
            .entry((
                domain.certification_id.as_str(),
                domain.certification_version.as_str(),
            ))
            .or_default();
        for node in domain.nodes() {
            nodes.insert(node.id.as_str());
        }
    }

    for bundle in bundles {
        let Some(nodes) =
            nodes_by_version.get(&(bundle.certification.id.as_str(), bundle.version.id.as_str()))
        else {
            // No learning content for this version: skip the check so a quiz
            // bundle can be authored ahead of its knowledge map.
            continue;
        };

        for question in &bundle.questions {
            for error_code in &question.error_codes {
                let Some(node_id) = error_code
                    .remediation
                    .as_ref()
                    .and_then(|remediation| remediation.node_id.as_deref())
                else {
                    continue;
                };
                if !nodes.contains(node_id) {
                    errors.push(ContentError::new(
                        "error_remediation_unknown_node",
                        format!(
                            "question {} error code {} remediation references unknown learning node {} for version {}",
                            question.id, error_code.code, node_id, bundle.version.id
                        ),
                    ));
                }
            }
        }
    }
}

/// Rejects two learning domains claiming the same certification/version/domain.
fn validate_unique_learning_domains(domains: &[LearningDomain], errors: &mut Vec<ContentError>) {
    let mut seen = HashSet::new();
    for domain in domains {
        let key = (
            domain.certification_id.as_str(),
            domain.certification_version.as_str(),
            domain.domain.id.as_str(),
        );
        if !seen.insert(key) {
            errors.push(ContentError::new(
                "duplicate_learning_domain",
                format!(
                    "duplicate learning domain {} for certification version {}",
                    domain.domain.id, domain.certification_version
                ),
            ));
        }
    }
}

/// Cross-checks a learning domain against the quiz bundle for its version.
///
/// When no quiz bundle exists yet, learning content is still valid on its own;
/// the cross-check only runs when there is something to check against.
fn validate_learning_against_bundles(
    domain: &LearningDomain,
    bundles: &[ContentBundle],
    errors: &mut Vec<ContentError>,
) {
    let Some(bundle) = bundles.iter().find(|bundle| {
        bundle.certification.id == domain.certification_id
            && bundle.version.id == domain.certification_version
    }) else {
        return;
    };

    let Some(official_domain) = bundle
        .version
        .domains
        .iter()
        .find(|candidate| candidate.id == domain.domain.id)
    else {
        errors.push(ContentError::new(
            "learning_domain_unknown",
            format!(
                "learning domain {} is not part of certification version {}",
                domain.domain.id, domain.certification_version
            ),
        ));
        return;
    };

    if (official_domain.weight - domain.domain.weight).abs() > 1e-6 {
        errors.push(ContentError::new(
            "learning_domain_weight_mismatch",
            format!(
                "learning domain {} weight {} does not match the blueprint weight {}",
                domain.domain.id, domain.domain.weight, official_domain.weight
            ),
        ));
    }

    let concept_ids: HashSet<&str> = bundle
        .concepts
        .iter()
        .map(|concept| concept.id.as_str())
        .collect();
    for node in domain.nodes() {
        for concept_id in &node.concept_ids {
            if !concept_ids.contains(concept_id.as_str()) {
                errors.push(ContentError::new(
                    "learning_unknown_concept",
                    format!(
                        "knowledge node {} references unknown concept {}",
                        node.id, concept_id
                    ),
                ));
            }
        }
    }

    let official_tasks: HashSet<&str> = official_domain
        .tasks
        .iter()
        .map(|task| task.id.as_str())
        .collect();
    for module in &domain.modules {
        for task_id in &module.task_ids {
            if !official_tasks.contains(task_id.as_str()) {
                errors.push(ContentError::new(
                    "learning_unknown_task",
                    format!(
                        "learning module {} references unknown task {} for domain {}",
                        module.id, task_id, domain.domain.id
                    ),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_source_error_names_the_file() {
        let sources = [SourceRef {
            path: Some("content/bad/quiz.json"),
            json: "{}",
        }];
        let mut errors = Vec::new();

        let bundles = parse_bundles(&sources, &mut errors);

        assert!(bundles.is_empty());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].code, "invalid_json");
        assert_eq!(errors[0].source.as_deref(), Some("content/bad/quiz.json"));
    }

    #[test]
    fn assemble_keeps_valid_sources_and_skips_invalid_ones() {
        let sources = [
            SourceRef {
                path: Some("content/good/bundle.json"),
                json: EMBEDDED_SOURCES[0].json,
            },
            SourceRef {
                path: Some("content/bad/quiz.json"),
                json: "{\"not\":\"a bundle\"}",
            },
        ];

        let assembled = assemble(&sources, &[], &[], &[]);

        assert!(
            !assembled.bundles.is_empty(),
            "the valid source must survive"
        );
        assert_eq!(assembled.errors.len(), 1);
        assert_eq!(
            assembled.errors[0].source.as_deref(),
            Some("content/bad/quiz.json")
        );
    }

    #[test]
    fn questions_for_module_come_from_its_declared_tasks() {
        let registry = ContentRegistry::embedded().expect("embedded content is valid");

        let module = registry
            .learning_modules("saa-c03", "domain-1")
            .and_then(|modules| {
                modules
                    .iter()
                    .find(|module| module.id == "domain-1-module-1")
            })
            .expect("known learning module");

        let questions = registry.questions_for_module("saa-c03", "domain-1", &module.id);
        assert!(!questions.is_empty(), "module must resolve some questions");
        for question in &questions {
            assert!(
                module.task_ids.contains(&question.task_id),
                "question {} is outside the module's tasks",
                question.id
            );
        }

        assert!(
            registry
                .questions_for_module("saa-c03", "domain-1", "missing-module")
                .is_empty()
        );
    }
}
