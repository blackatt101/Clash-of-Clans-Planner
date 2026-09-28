/**
 * Every dialog the planner can show. The page keeps a stack of these so an
 * editor opened from inside Strategy Setup replaces it rather than nesting on
 * top of it, and closing returns you to where you came from.
 */
export type ModalKey =
  | "settings"
  | "share"
  | "onboarding"
  | "offense"
  | "heroOrder"
  | "petOrder"
  | "labOrder"
  | "groupOrder";
