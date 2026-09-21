//! Derives Knowledge Map availability from raw client discovery progress.
//!
//! The frontend stores only raw reveals (`revealed_prompt_ids` and namespaced
//! `revealed_element_ids`) and derives node/module state with
//! `deriveLearningState` in `apps/web/src/state/learningProgress.ts`. The planner
//! needs the same semantics, so this module mirrors that derivation on the
//! server from the same raw input. Keeping one rule set means the planner can
//! never recommend a node the Knowledge Map would still show as locked.
//!
//! Discovery progress is client-supplied and is only a planning hint. It is
//! never learning evidence, and these functions do not touch scoring or concept
//! state.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::learning::{
    KnowledgeNode, KnowledgePrompt, LearningDomain, LearningReveal, progressive_reveal_units,
};

/// Raw discovery progress for one learning domain, as stored on the client.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DomainDiscoveryInput {
    /// Domain identifier.
    pub domain_id: String,
    /// Knowledge node id to the prompt ids the learner has revealed.
    #[serde(default)]
    pub revealed_prompt_ids: BTreeMap<String, Vec<String>>,
    /// Knowledge node id to prompt id to revealed discovery element ids.
    #[serde(default)]
    pub revealed_element_ids: BTreeMap<String, BTreeMap<String, Vec<String>>>,
}

/// Derived discovery state for one learning domain.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DomainDiscoveryState {
    /// Nodes the learner has interacted with in any way.
    pub explored_node_ids: HashSet<String>,
    /// Nodes whose required prompts are all complete.
    pub unlocked_node_ids: HashSet<String>,
    /// Modules whose every node is unlocked.
    pub completed_module_ids: HashSet<String>,
}

/// Merges two discovery inputs with monotonic set-union semantics.
///
/// Discovery is append-only: every revealed prompt and element present in either
/// input is present in the result, so an older device sending stale state can
/// never remove a newer reveal. Duplicate ids collapse, which makes repeated
/// batches idempotent. The domain id comes from `base` when it is non-empty,
/// otherwise from `incoming`.
pub fn merge_domain_discovery(
    base: &DomainDiscoveryInput,
    incoming: &DomainDiscoveryInput,
) -> DomainDiscoveryInput {
    let domain_id = if base.domain_id.is_empty() {
        incoming.domain_id.clone()
    } else {
        base.domain_id.clone()
    };

    DomainDiscoveryInput {
        domain_id,
        revealed_prompt_ids: merge_prompt_maps(
            &base.revealed_prompt_ids,
            &incoming.revealed_prompt_ids,
        ),
        revealed_element_ids: merge_element_maps(
            &base.revealed_element_ids,
            &incoming.revealed_element_ids,
        ),
    }
}

/// Unions two `node -> prompt ids` maps, sorting each id list for determinism.
fn merge_prompt_maps(
    base: &BTreeMap<String, Vec<String>>,
    incoming: &BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, Vec<String>> {
    let mut merged = base.clone();
    for (node_id, ids) in incoming {
        let entry = merged.entry(node_id.clone()).or_default();
        entry.extend(ids.iter().cloned());
        entry.sort();
        entry.dedup();
    }
    for ids in merged.values_mut() {
        ids.sort();
        ids.dedup();
    }
    merged
}

/// Unions two `node -> prompt -> element ids` maps, sorting each id list.
fn merge_element_maps(
    base: &BTreeMap<String, BTreeMap<String, Vec<String>>>,
    incoming: &BTreeMap<String, BTreeMap<String, Vec<String>>>,
) -> BTreeMap<String, BTreeMap<String, Vec<String>>> {
    let mut merged = base.clone();
    for (node_id, prompts) in incoming {
        let node = merged.entry(node_id.clone()).or_default();
        for (prompt_id, ids) in prompts {
            let entry = node.entry(prompt_id.clone()).or_default();
            entry.extend(ids.iter().cloned());
            entry.sort();
            entry.dedup();
        }
    }
    for prompts in merged.values_mut() {
        for ids in prompts.values_mut() {
            ids.sort();
            ids.dedup();
        }
    }
    merged
}

/// Derives explored/unlocked nodes and completed modules for a domain.
///
/// Unknown node, prompt, or element ids are ignored, so stale progress recorded
/// against a previous content revision never breaks a newer map.
pub fn derive_domain_discovery(
    domain: &LearningDomain,
    input: &DomainDiscoveryInput,
) -> DomainDiscoveryState {
    let mut explored_node_ids = HashSet::new();
    let mut unlocked_node_ids = HashSet::new();

    for module in &domain.modules {
        for node in &module.nodes {
            let revealed_prompts = revealed_prompt_set(input, &node.id);
            let revealed_elements = revealed_element_sets(input, &node.id);

            let explored = !revealed_prompts.is_empty()
                || revealed_elements.values().any(|ids| !ids.is_empty());
            if explored {
                explored_node_ids.insert(node.id.clone());
            }
            if is_node_unlocked(node, &revealed_prompts, &revealed_elements) {
                unlocked_node_ids.insert(node.id.clone());
            }
        }
    }

    let mut completed_module_ids = HashSet::new();
    for module in &domain.modules {
        if !module.nodes.is_empty()
            && module
                .nodes
                .iter()
                .all(|node| unlocked_node_ids.contains(&node.id))
        {
            completed_module_ids.insert(module.id.clone());
        }
    }

    DomainDiscoveryState {
        explored_node_ids,
        unlocked_node_ids,
        completed_module_ids,
    }
}

fn revealed_prompt_set<'a>(input: &'a DomainDiscoveryInput, node_id: &str) -> HashSet<&'a str> {
    input
        .revealed_prompt_ids
        .get(node_id)
        .map(|ids| ids.iter().map(String::as_str).collect())
        .unwrap_or_default()
}

fn revealed_element_sets<'a>(
    input: &'a DomainDiscoveryInput,
    node_id: &str,
) -> BTreeMap<&'a str, HashSet<&'a str>> {
    input
        .revealed_element_ids
        .get(node_id)
        .map(|prompts| {
            prompts
                .iter()
                .map(|(prompt_id, ids)| {
                    (prompt_id.as_str(), ids.iter().map(String::as_str).collect())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The prompts that count toward a node's completion.
///
/// A node normally has required prompts; a node authored with none falls back to
/// all of its prompts, matching the Knowledge Map.
pub fn completion_prompts(node: &KnowledgeNode) -> Vec<&KnowledgePrompt> {
    let required: Vec<&KnowledgePrompt> = node
        .prompts
        .iter()
        .filter(|prompt| prompt.required)
        .collect();
    if required.is_empty() {
        node.prompts.iter().collect()
    } else {
        required
    }
}

/// Whether every required prompt on a node is complete.
pub fn is_node_unlocked(
    node: &KnowledgeNode,
    revealed_prompt_ids: &HashSet<&str>,
    revealed_element_ids: &BTreeMap<&str, HashSet<&str>>,
) -> bool {
    let required = completion_prompts(node);
    !required.is_empty()
        && required
            .iter()
            .all(|prompt| is_prompt_complete(prompt, revealed_prompt_ids, revealed_element_ids))
}

/// Whether one prompt counts as complete, mirroring the Knowledge Map rules.
pub fn is_prompt_complete(
    prompt: &KnowledgePrompt,
    revealed_prompt_ids: &HashSet<&str>,
    revealed_element_ids: &BTreeMap<&str, HashSet<&str>>,
) -> bool {
    match &prompt.reveal {
        LearningReveal::CodeFile { annotations, .. } => {
            let required: Vec<&str> = annotations
                .iter()
                .filter(|annotation| annotation.required)
                .map(|annotation| annotation.id.as_str())
                .collect();
            if required.is_empty() {
                return revealed_prompt_ids.contains(prompt.id.as_str());
            }
            let elements = revealed_element_ids.get(prompt.id.as_str());
            required.iter().all(|id| {
                let element = format!("annotation:{id}");
                elements.is_some_and(|set| set.contains(element.as_str()))
            })
        }
        LearningReveal::Table {
            columns,
            rows,
            progressive_reveal: Some(progressive),
        } => {
            let units = progressive_reveal_units(progressive, columns, rows);
            let elements = revealed_element_ids.get(prompt.id.as_str());
            !units.is_empty()
                && units
                    .iter()
                    .all(|unit| elements.is_some_and(|set| set.contains(unit.as_str())))
        }
        _ => revealed_prompt_ids.contains(prompt.id.as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::{
        CodeAnnotation, CodeAnnotationAnchor, KnowledgeNode, KnowledgePrompt, LearningCoverage,
        LearningDesign, LearningDomainMeta, LearningModule, LearningReveal, MapPosition,
        PromptKind, RevealTableColumn, RevealTableRow, TableInitialVisibility,
        TableProgressiveReveal, TableRevealMode,
    };

    fn prompt(id: &str, reveal: LearningReveal) -> KnowledgePrompt {
        KnowledgePrompt {
            id: id.to_owned(),
            kind: PromptKind::What,
            label: id.to_owned(),
            placeholder: "reveal".to_owned(),
            required: true,
            reveal,
        }
    }

    fn node(id: &str, prompts: Vec<KnowledgePrompt>) -> KnowledgeNode {
        KnowledgeNode {
            id: id.to_owned(),
            title: id.to_owned(),
            concept_ids: vec![format!("{id}.concept")],
            prerequisite_node_ids: Vec::new(),
            map_position: MapPosition { x: 0.0, y: 0.0 },
            prompts,
            source_refs: Vec::new(),
        }
    }

    fn module(id: &str, prereqs: &[&str], nodes: Vec<KnowledgeNode>) -> LearningModule {
        LearningModule {
            id: id.to_owned(),
            title: id.to_owned(),
            order: 1,
            task_ids: Vec::new(),
            skill_ids: Vec::new(),
            prerequisite_module_ids: prereqs.iter().map(|id| (*id).to_owned()).collect(),
            nodes,
        }
    }

    fn domain(modules: Vec<LearningModule>) -> LearningDomain {
        LearningDomain {
            schema_version: "1.0.0".to_owned(),
            content_version: "c1".to_owned(),
            certification_id: "track".to_owned(),
            certification_version: "v1".to_owned(),
            exam_guide_revision: None,
            domain: LearningDomainMeta {
                id: "domain-1".to_owned(),
                name: "Domain".to_owned(),
                weight: 1.0,
            },
            learning_design: LearningDesign {
                progress_label: "Progress".to_owned(),
                unlock_rule: "Unlock".to_owned(),
                mastery_note: "Note".to_owned(),
            },
            source_refs: Vec::new(),
            glossary: Vec::new(),
            coverage: LearningCoverage {
                task_ids: Vec::new(),
                skill_ids: Vec::new(),
                module_count: 0,
                knowledge_node_count: 0,
                prompt_count: 0,
            },
            authoring_notes: None,
            modules,
        }
    }

    fn input(
        revealed_prompt_ids: &[(&str, &[&str])],
        revealed_element_ids: &[(&str, &str, &[&str])],
    ) -> DomainDiscoveryInput {
        let mut prompt_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (node_id, prompts) in revealed_prompt_ids {
            prompt_map.insert(
                (*node_id).to_owned(),
                prompts.iter().map(|id| (*id).to_owned()).collect(),
            );
        }
        let mut element_map: BTreeMap<String, BTreeMap<String, Vec<String>>> = BTreeMap::new();
        for (node_id, prompt_id, ids) in revealed_element_ids {
            element_map
                .entry((*node_id).to_owned())
                .or_default()
                .insert(
                    (*prompt_id).to_owned(),
                    ids.iter().map(|id| (*id).to_owned()).collect(),
                );
        }
        DomainDiscoveryInput {
            domain_id: "domain-1".to_owned(),
            revealed_prompt_ids: prompt_map,
            revealed_element_ids: element_map,
        }
    }

    #[test]
    fn plain_prompt_completion_unlocks_a_node() {
        let domain = domain(vec![module(
            "m1",
            &[],
            vec![node(
                "n1",
                vec![prompt(
                    "p1",
                    LearningReveal::Text {
                        text: "x".to_owned(),
                    },
                )],
            )],
        )]);

        let untouched = derive_domain_discovery(&domain, &DomainDiscoveryInput::default());
        assert!(!untouched.unlocked_node_ids.contains("n1"));
        assert!(!untouched.completed_module_ids.contains("m1"));

        let revealed = derive_domain_discovery(&domain, &input(&[("n1", &["p1"])], &[]));
        assert!(revealed.unlocked_node_ids.contains("n1"));
        assert!(revealed.completed_module_ids.contains("m1"));
        assert!(revealed.explored_node_ids.contains("n1"));
    }

    #[test]
    fn partially_revealed_node_is_explored_but_not_unlocked() {
        let domain = domain(vec![module(
            "m1",
            &[],
            vec![node(
                "n1",
                vec![
                    prompt(
                        "p1",
                        LearningReveal::Text {
                            text: "x".to_owned(),
                        },
                    ),
                    prompt(
                        "p2",
                        LearningReveal::Text {
                            text: "y".to_owned(),
                        },
                    ),
                ],
            )],
        )]);

        let state = derive_domain_discovery(&domain, &input(&[("n1", &["p1"])], &[]));
        assert!(state.explored_node_ids.contains("n1"));
        assert!(!state.unlocked_node_ids.contains("n1"));
        assert!(!state.completed_module_ids.contains("m1"));
    }

    #[test]
    fn code_file_requires_its_required_annotations() {
        let reveal = LearningReveal::CodeFile {
            filename: "main.tf".to_owned(),
            language: "hcl".to_owned(),
            code: "resource \"x\" \"y\" {}".to_owned(),
            line_numbers: true,
            annotations: vec![
                CodeAnnotation {
                    id: "a1".to_owned(),
                    anchor: CodeAnnotationAnchor {
                        line: 1,
                        text: "resource".to_owned(),
                        occurrence: 1,
                    },
                    title: "A1".to_owned(),
                    explanation: "first".to_owned(),
                    required: true,
                },
                CodeAnnotation {
                    id: "a2".to_owned(),
                    anchor: CodeAnnotationAnchor {
                        line: 1,
                        text: "x".to_owned(),
                        occurrence: 1,
                    },
                    title: "A2".to_owned(),
                    explanation: "second".to_owned(),
                    required: false,
                },
            ],
        };
        let domain = domain(vec![module(
            "m1",
            &[],
            vec![node("n1", vec![prompt("p1", reveal)])],
        )]);

        // Revealing the prompt alone is not enough for a required annotation.
        let prompt_only = derive_domain_discovery(&domain, &input(&[("n1", &["p1"])], &[]));
        assert!(!prompt_only.unlocked_node_ids.contains("n1"));

        // A required annotation unlocks it; the optional one is not needed.
        let required_only =
            derive_domain_discovery(&domain, &input(&[], &[("n1", "p1", &["annotation:a1"])]));
        assert!(required_only.unlocked_node_ids.contains("n1"));
    }

    #[test]
    fn progressive_table_requires_its_hidden_units() {
        let reveal = LearningReveal::Table {
            columns: vec![
                RevealTableColumn {
                    id: "c1".to_owned(),
                    label: "C1".to_owned(),
                },
                RevealTableColumn {
                    id: "c2".to_owned(),
                    label: "C2".to_owned(),
                },
            ],
            rows: vec![RevealTableRow {
                id: Some("r1".to_owned()),
                cells: BTreeMap::from([
                    ("c1".to_owned(), "v1".to_owned()),
                    ("c2".to_owned(), "v2".to_owned()),
                ]),
            }],
            progressive_reveal: Some(TableProgressiveReveal {
                mode: TableRevealMode::Cell,
                initially_visible: TableInitialVisibility::default(),
            }),
        };
        let domain = domain(vec![module(
            "m1",
            &[],
            vec![node("n1", vec![prompt("p1", reveal)])],
        )]);

        let incomplete =
            derive_domain_discovery(&domain, &input(&[], &[("n1", "p1", &["cell:r1:c1"])]));
        assert!(!incomplete.unlocked_node_ids.contains("n1"));

        let complete = derive_domain_discovery(
            &domain,
            &input(&[], &[("n1", "p1", &["cell:r1:c1", "cell:r1:c2"])]),
        );
        assert!(complete.unlocked_node_ids.contains("n1"));
    }

    #[test]
    fn module_completion_requires_every_node_unlocked() {
        let domain = domain(vec![module(
            "m1",
            &[],
            vec![
                node(
                    "n1",
                    vec![prompt(
                        "p1",
                        LearningReveal::Text {
                            text: "x".to_owned(),
                        },
                    )],
                ),
                node(
                    "n2",
                    vec![prompt(
                        "p2",
                        LearningReveal::Text {
                            text: "y".to_owned(),
                        },
                    )],
                ),
            ],
        )]);

        let one = derive_domain_discovery(&domain, &input(&[("n1", &["p1"])], &[]));
        assert!(!one.completed_module_ids.contains("m1"));

        let both =
            derive_domain_discovery(&domain, &input(&[("n1", &["p1"]), ("n2", &["p2"])], &[]));
        assert!(both.completed_module_ids.contains("m1"));
        assert_eq!(both.unlocked_node_ids.len(), 2);
    }

    #[test]
    fn merge_is_a_monotonic_set_union() {
        let older = input(
            &[("n1", &["p1"]), ("n2", &["p1"])],
            &[("n1", "p1", &["annotation:a1"])],
        );
        let newer = input(
            &[("n1", &["p1", "p2"]), ("n3", &["p1"])],
            &[
                ("n1", "p1", &["annotation:a1", "annotation:a2"]),
                ("n2", "p1", &["cell:r1:c1"]),
            ],
        );

        // Order must not matter: union is commutative.
        let forward = merge_domain_discovery(&older, &newer);
        let backward = merge_domain_discovery(&newer, &older);
        assert_eq!(forward, backward);

        // Older state can never remove a newer reveal.
        let stale = input(&[("n1", &["p1"])], &[]);
        let merged = merge_domain_discovery(&newer, &stale);
        assert_eq!(merged.revealed_prompt_ids["n1"], vec!["p1", "p2"]);
        assert_eq!(
            merged.revealed_element_ids["n1"]["p1"],
            vec!["annotation:a1", "annotation:a2"]
        );
        assert_eq!(merged.revealed_prompt_ids["n3"], vec!["p1"]);
    }

    #[test]
    fn merge_deduplicates_repeated_ids() {
        let once = input(&[("n1", &["p1"])], &[("n1", "p1", &["annotation:a1"])]);
        let duplicated = input(
            &[("n1", &["p1", "p1"])],
            &[("n1", "p1", &["annotation:a1", "annotation:a1"])],
        );

        let merged = merge_domain_discovery(&once, &duplicated);
        assert_eq!(merged.revealed_prompt_ids["n1"], vec!["p1"]);
        assert_eq!(
            merged.revealed_element_ids["n1"]["p1"],
            vec!["annotation:a1"]
        );
    }

    #[test]
    fn merged_discovery_derives_the_same_state_as_the_union() {
        let domain = domain(vec![module(
            "m1",
            &[],
            vec![node(
                "n1",
                vec![
                    prompt(
                        "p1",
                        LearningReveal::Text {
                            text: "x".to_owned(),
                        },
                    ),
                    prompt(
                        "p2",
                        LearningReveal::Text {
                            text: "y".to_owned(),
                        },
                    ),
                ],
            )],
        )]);

        let device_a = input(&[("n1", &["p1"])], &[]);
        let device_b = input(&[("n1", &["p2"])], &[]);
        let merged = merge_domain_discovery(&device_a, &device_b);
        let state = derive_domain_discovery(&domain, &merged);

        assert!(state.unlocked_node_ids.contains("n1"));
        assert!(state.completed_module_ids.contains("m1"));
    }
}
