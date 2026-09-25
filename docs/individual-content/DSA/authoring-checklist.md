# DSA Authoring Checklist

Use this after Phase 1 metadata exists and before converting blueprints into production JSON.

## Per family

- [ ] Defined in plain language.
- [ ] Problem shape is explicit.
- [ ] Brute-force/repeated work is shown.
- [ ] Maintained state is explained.
- [ ] Invariant is stated.
- [ ] At least one confusion pair is authored where meaningful.
- [ ] At least two different surface contexts exist for Tier A families.
- [ ] At least one worked/subgoal example exists.
- [ ] At least one trace or reconstruction activity exists.
- [ ] At least one diagnosis activity exists.
- [ ] At least one construction activity exists.
- [ ] At least one cold/unlabeled transfer activity exists.
- [ ] Difficulty and scaffold level are not conflated.
- [ ] Pattern name is not leaked in cold practice.
- [ ] Technical claims have authoritative sources.
- [ ] Examples do not copy proprietary question-bank wording.

## Per question

- [ ] One main decision per interaction.
- [ ] `family_id` matches the deep structure.
- [ ] `stage` matches what the learner actually does.
- [ ] `scaffold_level` reflects embedded support.
- [ ] `surface_context` is meaningful, not cosmetic numbering.
- [ ] `transfer_group_id` is used only when deep structure genuinely transfers.
- [ ] `challenge_group_id` groups a coherent journey.
- [ ] Concept mapping is granular enough to identify weakness.
- [ ] Distractors are plausible.
- [ ] Wrong-answer feedback teaches the decisive distinction.
- [ ] No answer-position/wording leak.
- [ ] Python code/tests are behaviorally validated.
- [ ] Source refs support the exact claim.

## Per domain

- [ ] Tier A families have recognition, differentiation, reasoning, trace/diagnose, construct, and transfer coverage.
- [ ] Question types are not repetitive.
- [ ] Surface contexts are varied.
- [ ] Similar families are deliberately interleaved after initial acquisition.
- [ ] Learning material teaches every scored concept first.
- [ ] ADHD readability review completed.
- [ ] Rust content validation passes once production JSON exists.
- [ ] Independent fact/English/content-quality audit completed.
