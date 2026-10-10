// Automation flags (leaf module: no imports, safe from import cycles).
export const AUTO_DEVELOP = 1, AUTO_BUILD = 2, AUTO_BUDGET = 4, AUTO_ADVISORS = 8, AUTO_FOCUS = 16, AUTO_DIPLOMACY = 64, AUTO_ARMY = 128;
export const AUTO_ALL = AUTO_DEVELOP | AUTO_BUILD | AUTO_BUDGET | AUTO_ADVISORS | AUTO_FOCUS | AUTO_DIPLOMACY | AUTO_ARMY;
/** Player-only: events wait for a choice instead of the AI deciding. */
export const PLAYER_EVENTS = 32;
