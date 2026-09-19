// All tenants a token's cookies can be scoped to. politemall/nyp are D2L Brightspace
// tenants (see api/d2l-client.ts); step is the separate SkillsFuture enrollment/records portal
// at stms.polite.edu.sg (see api/step-client.ts) — different data model, different API.
export type School = "politemall" | "nyp" | "step";

export type D2LSchool = Extract<School, "politemall" | "nyp">;
