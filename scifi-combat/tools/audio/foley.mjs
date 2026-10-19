// The close-up sounds from the recordings: weapon handling, spent brass, cloth and bodies, digging,
// footsteps by surface, hits on metal, wood and flesh, melee, the UI and the call-ins. Each a deck
// of takes (a few varispeeded so there are always more than three), levelled by kind.

import * as B from './lib.mjs';

const M = (n) => `Modern_Firearms_Military_Pack/${n}.wav`;
const F = (n) => `SciFi_Cyberpunk_SFX_Pack/${n}.wav`;
const G = (dir, n) => `${dir}/${n}.wav`;
const V3 = (f) => [1, 2, 3].map((i) => f(`0${i}`));

/** id -> { kind ('near' close-up | 'ui' your screen), takes: [buffers] } */
export function foley() {
  const R = {};
  const add = (id, kind, takes) => { R[id] = { kind, takes }; };
  const T = (rel, sec, db = -30) => B.upto(B.trim(B.read(rel), db), sec);
  // More takes from fewer: each recording again a few % up and down.
  const spread = (list, ks = [1, 0.94, 1.06]) => ks.flatMap((k) => list.map((b) => (k === 1 ? b : B.pitch(b, k))));
  // Steep low-passes: some of the recordings carry a whine up at 8-18 kHz that has no business in a mix.
  const soft = (b, f, stages = 3) => B.eq(b, Array.from({ length: stages }, () => ['lowpass', f, 0.7]));

  // ---- weapon handling
  add('mech:magout', 'near', spread(V3((v) => T(M(`Foley_Mag_Eject_Empty_var${v}`), 0.7))));
  add('mech:magin', 'near', spread(V3((v) => T(M(`Foley_Mag_Insert_Lock_var${v}`), 0.8))));
  add('mech:bolt', 'near', spread(V3((v) => T(M(`Foley_Bolt_Cock_Pull_var${v}`), 1.0))));
  add('mech:pump', 'near', spread(V3((v) => B.pitch(T(M(`Foley_Bolt_Cock_Pull_var${v}`), 0.9), 0.84)), [1, 0.95]));
  add('mech:swap', 'near', spread(['weapon_equip', 'weapon_equip_short', 'weapon_unequip'].map((n) => soft(T(G('Weapons', n), 0.7), 8000))));
  add('mech:dry', 'near', spread(['click_double_off', 'click_double_off_2', 'toggle_off'].map((n) => T(G('UI', n), 0.25))));
  add('mech:vent', 'near', spread(V3((v) => soft(T(F(`Weapon_Energy_Reload_var${v}`), 1.3), 7000, 2)), [1, 0.92]));
  add('mech:overheat', 'near', spread(V3((v) => soft(T(F(`SciFi_Hologram_Flicker_var${v}`), 1.0), 4500)), [1, 0.9]));
  // Spent brass: bright on hard ground, dull in dirt, all but gone in snow.
  const shell = spread(V3((v) => B.upto(B.trim(B.read(M(`Foley_Bullet_Shell_Drop_var${v}`))), 0.5, 0.2)), [1, 0.92, 1.08]);
  add('brass:hard', 'near', shell);
  add('brass:dirt', 'near', shell.map((b) => B.gain(B.eq(b, [['lowpass', 1800, 0.7]]), -6)));
  add('brass:snow', 'near', shell.map((b) => B.gain(B.eq(b, [['lowpass', 700, 0.7]]), -12)));
  add('cloth', 'near', spread(['clothing_1', 'clothing_2'].map((n) => T(G('Materials', n), 0.8)), [1, 1.1, 0.92]));
  add('body:heavy', 'near', [1.0, 0.9, 0.82, 0.95, 0.86].map((k) => B.eq(B.mix(T(G('Materials', 'clothing_thud'), 0.6), B.pitch(B.trim(B.read(G('Weapons', 'harsh_thud'))), k * 0.8), 0, -6), [['lowpass', 4000, 0.7]])));
  add('body:slide', 'near', [1.0, 0.9, 1.12, 0.95].map((k) => B.pitch(T(G('Materials', 'concrete_scrape'), 1.0), k)));
  add('dig', 'near', [1.0, 0.92, 1.08, 0.97].map((k) => B.pitch(T(G('Items', 'shovel_dig'), 1.2), k)));

  // ---- footsteps
  const S = (rel) => B.upto(B.trim(B.read(rel), -50), 0.45, 0.12);
  const four = (f) => [1, 2, 3, 4].map(f);
  add('foot:concrete', 'near', spread(four((i) => S(G('Footsteps', `foley_footstep_concrete_${i}`))), [1, 0.94]));
  add('foot:dirt', 'near', [...four((i) => S(G('Footsteps', `foley_footstep_gravel_${i}`))), ...four((i) => S(G('Footsteps/digital', `digital_footstep_gravel_${i}`)))]);
  add('foot:snow', 'near', spread(four((i) => S(G('Footsteps/digital', `digital_footstep_snow_${i}`))), [1, 0.93]));
  add('foot:wood', 'near', spread(four((i) => S(G('Footsteps/digital', `digital_footstep_wood_${i}`))), [1, 0.94]));
  const tap = B.trim(B.read(G('Materials', 'metal_blunt_tap')));
  add('foot:metal', 'near', spread(four((i) => B.mix(S(G('Footsteps', `foley_footstep_vinyl_${i}`)), B.upto(B.pitch(tap, 1.2 + i * 0.05), 0.3), 0.004, -16)), [1, 0.95]));

  // ---- hits
  const H = (rel, sec) => B.upto(B.trim(B.read(rel)), sec);
  add('impact:metal', 'near', spread([H(G('Materials', 'metal_clang'), 0.6), H(G('Materials', 'metal_blunt_tap'), 0.5), B.pitch(H(G('Materials', 'metal_clang'), 0.6), 1.2), B.pitch(H(G('Materials', 'pottery_clang'), 0.5), 0.9)], [1, 1.08]));
  add('impact:vehicle', 'near', [0.7, 0.74, 0.78, 0.82, 0.86].map((k) => B.pitch(H(G('Materials', 'metal_clang'), 0.7), k)));
  add('impact:wood', 'near', spread([H(G('Materials', 'wood_small_drop'), 0.4), H(G('Materials', 'wood_small_hollow'), 0.4), H(G('Materials', 'bamboo_drop'), 0.4)], [1, 0.9]));
  add('impact:flesh', 'near', ['splat_quick', 'splat_double_quick', 'crunch_splat', 'crunch_splat_2', 'squelching_1'].map((n) => H(G('Combat and Gore', n), 0.35)));

  // ---- melee
  add('melee:swing', 'near', spread([H(G('Combat and Gore', 'swipe'), 0.5), H(G('Weapons', 'sword_light'), 0.5)], [1, 1.15, 0.92]));
  add('melee:hit', 'near', [...['punch', 'punch_2', 'punch_3', 'kick'].map((n) => H(G('Combat and Gore', n), 0.45)), ...V3((v) => H(M(`Tactical_Knife_Stab_Slash_var${v}`), 0.5))]);
  add('melee:block', 'near', spread([H(G('Weapons', 'sword_clash'), 0.8), H(G('Weapons', 'sword_clash_2'), 0.8)], [1, 0.92, 1.06]));
  add('melee:parry', 'near', [1.15, 1.22, 1.3].map((k) => B.pitch(H(G('Weapons', 'sword_clash_2'), 0.8), k)));
  add('melee:deflect', 'near', [1.3, 1.4, 1.5].map((k) => B.pitch(H(G('Weapons', 'sword_clash'), 0.6), k)));
  add('melee:guardbreak', 'near', [0.9, 1.0, 1.1].map((k) => B.mix(B.pitch(H(G('Combat and Gore', 'bone_snap'), 0.6), k), H(G('Weapons', 'harsh_thud'), 0.6), 0, -4)));

  // ---- the UI and the call-ins
  const U = (n, sec) => H(G('UI', n), sec);
  add('ui:hit', 'ui', [1, 2, 3, 4].map((i) => B.pitch(U(`pop_${i}`, 0.2), 1.25)));
  // A headshot: the select's soft chime a little higher, not the shrill hover tone.
  add('ui:hit_head', 'ui', [1.18, 1.24, 1.3].map((k) => B.eq(B.pitch(U('sci_fi_select', 0.3), k), [['lowpass', 7000, 0.7]])));
  add('ui:hit_kill', 'ui', [1.0, 1.04, 0.96].map((k) => B.pitch(U('sci_fi_select', 0.45), k)));
  add('ui:hit_plink', 'ui', [1.3, 1.4, 1.5].map((k) => B.gain(B.pitch(U('click_double_off', 0.2), k), -4)));
  add('ui:hit_shieldbreak', 'ui', [1.0, 1.08, 0.94].map((k) => B.pitch(U('sci_fi_deselect', 0.5), k)));
  add('ui:hit_friendly', 'ui', [1.0, 1.05, 0.95].map((k) => B.pitch(U('sci_fi_disallow', 0.5), k)));
  add('ui:ability_hit', 'ui', [1.1, 1.18, 1.26].map((k) => B.pitch(U('sci_fi_select', 0.35), k)));
  add('ui:open', 'ui', V3((v) => H(F(`SciFi_UI_Beep_Select_var${v}`), 0.6)));
  const beep = H(F('SciFi_UI_Beep_Select_var03'), 0.4);
  for (let k = 1; k <= 10; k++) add(`arrow:${k}`, 'ui', [B.pitch(beep, 2 ** ((2 * (k - 1)) / 12))]);
  add('ui:error', 'ui', [U('sci_fi_error', 0.6), ...V3((v) => H(F(`SciFi_UI_Error_Denied_var${v}`), 0.6)).slice(0, 2)]);
  add('ui:denied', 'ui', [U('sci_fi_disallow', 0.5), U('synth_error', 0.5), H(F('SciFi_UI_Error_Denied_var03'), 0.6)]);
  add('ui:armed', 'ui', V3((v) => H(F(`SciFi_UI_Confirm_Access_var${v}`), 1.2)));
  add('ui:beacon', 'ui', V3((v) => soft(B.upto(H(F(`SciFi_UI_Data_Scanning_var${v}`), 2.5), 0.9, 0.3), 4500)));
  add('ui:beep', 'ui', [1.0, 1.04, 0.97].map((k) => B.eq(B.pitch(U('sci_fi_hover', 0.3), k), [['lowpass', 5000, 0.7]])));
  add('ui:throw', 'ui', [0.9, 1.0, 1.1].map((k) => B.pitch(H(G('Combat and Gore', 'swipe'), 0.5), k)));
  add('ui:grab', 'ui', [H(G('Weapons', 'weapon_pick_up'), 0.8), H(G('Items', 'item_equip'), 0.8), B.pitch(H(G('Weapons', 'weapon_pick_up'), 0.8), 1.08)]);
  add('ui:stim', 'ui', [1.0, 1.06, 0.95].map((k) => B.mix(B.pitch(H(G('Environment', 'air_burst'), 0.7), k), H(G('Items', 'item_equip'), 0.6), 0.12, -6)));
  add('ui:repair', 'ui', [H(G('Machines', 'hydraulic_up'), 1.0), H(G('Machines', 'hydraulic_down'), 1.0), B.pitch(H(G('Machines', 'hydraulic_up'), 1.0), 1.1)]);
  add('ui:bp', 'ui', [1, 2, 3, 4].map((i) => U(`select_${i}`, 0.4)));
  add('ui:buy', 'ui', [U('synth_confirmation', 1.0), B.pitch(U('synth_confirmation', 1.0), 1.06), U('sci_fi_confirm', 0.8)]);
  add('ui:ready', 'ui', [U('synth_process_complete', 1.0), B.pitch(U('synth_process_complete', 1.0), 1.06), U('sci_fi_select_big', 0.8)]);
  add('ui:super_ready', 'ui', V3((v) => H(F(`SciFi_Power_Core_Boot_var${v}`), 2.0)));
  add('ui:hero', 'ui', [H(G('Musical Effects', 'brass_level_start'), 3.0)]);
  add('ui:smoke', 'near', V3((v) => soft(H(M(`Tactical_Smoke_Grenade_Hiss_var${v}`), 2.8), 5500, 2)));
  add('ui:revive', 'ui', [U('sci_fi_confirm', 0.8), B.pitch(U('sci_fi_confirm', 0.8), 1.06), B.pitch(U('sci_fi_confirm', 0.8), 0.95)]);
  add('ui:revived', 'ui', [U('synth_process_complete', 1.2), B.pitch(U('synth_process_complete', 1.2), 1.05), B.pitch(U('synth_process_complete', 1.2), 0.96)]);
  add('ui:down', 'ui', [U('synth_shut_down', 1.5), B.pitch(U('synth_shut_down', 1.5), 0.95), B.pitch(U('synth_shut_down', 1.5), 1.05)]);
  add('ui:empty', 'ui', [U('click_double_off', 0.25), U('click_double_off_2', 0.25), B.pitch(U('click_double_off', 0.25), 0.9)]);
  add('pod:open', 'near', [...V3((v) => H(F(`SciFi_Door_Hydraulic_Open_var${v}`), 1.8)), H(G('Machines', 'industrial_door_open'), 2.0)]);
  add('music:victory', 'ui', [H(G('Musical Effects', 'brass_level_complete'), 6)]);
  add('music:defeat', 'ui', [H(G('Musical Effects', 'brass_defeated'), 6)]);
  // Nothing on your screen or in your hands shrill: the UI under 9 kHz, the handling's top end eased.
  for (const [id, e] of Object.entries(R)) {
    if (id.startsWith('ui:') || id.startsWith('arrow:')) e.takes = e.takes.map((b) => soft(b, 9000, 2));
    else if (id.startsWith('mech:')) e.takes = e.takes.map((b) => B.eq(b, [['highshelf', 7000, -4]]));
  }
  return R;
}

/** The punch each kind of close-up sound is levelled to (dBFS RMS of its loudest 150 ms). */
export function foleyLevel(id) {
  const P = [['foot:', -19], ['brass:', -22], ['mech:', -17], ['cloth', -19], ['body:', -17], ['impact:', -16], ['melee:', -14], ['arrow:', -18], ['music:', -15], ['pod:', -15], ['dig', -17], ['ui:hit', -18], ['ui:', -17]];
  return (P.find(([p]) => id.startsWith(p)) ?? [null, -17])[1];
}
