// All tenants a token's cookies can be scoped to. politemall/nyp are D2L Brightspace
// tenants (see d2l.ts); step is the separate SkillsFuture enrollment/records portal
// at stms.polite.edu.sg (see step.ts) — different data model, different API.
export type School = "politemall" | "nyp" | "step";
