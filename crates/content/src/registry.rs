use crate::model::{Certification, ContentBundle, Domain, Question, Task};
use crate::validate::{ContentError, validate};

/// The content bundle compiled into the API binary.
///
/// Embedding keeps the API portable across container hosts and makes content a
/// build-time dependency of tests.
pub const EMBEDDED_BUNDLE: &str =
    include_str!("../../../content/aws/soa-c03/soa-c03-content-v1.json");

/// An immutable set of validated content bundles.
#[derive(Debug, Clone)]
pub struct ContentRegistry {
    bundles: Vec<ContentBundle>,
}

impl ContentRegistry {
    /// Loads and validates the embedded bundle.
    pub fn embedded() -> Result<Self, Vec<ContentError>> {
        Self::from_json(&[EMBEDDED_BUNDLE])
    }

    /// Parses and validates one or more JSON bundles.
    pub fn from_json(sources: &[&str]) -> Result<Self, Vec<ContentError>> {
        let mut bundles = Vec::new();
        let mut errors = Vec::new();

        for source in sources {
            match serde_json::from_str::<ContentBundle>(source) {
                Ok(bundle) => match validate(&bundle) {
                    Ok(()) => bundles.push(bundle),
                    Err(mut found) => errors.append(&mut found),
                },
                Err(error) => errors.push(ContentError {
                    code: "invalid_json",
                    message: error.to_string(),
                }),
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
}
