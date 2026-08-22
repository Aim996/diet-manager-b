export const dietManagerActions = [
  "record_meal",
  "record_water",
  "add_inventory",
  "query_inventory",
  "query_meals",
  "query_daily_summary",
  "correct_record",
  "undo_record",
  "set_profile",
  "set_goal",
  "restore_record",
] as const;

export type DietManagerAction = (typeof dietManagerActions)[number];
