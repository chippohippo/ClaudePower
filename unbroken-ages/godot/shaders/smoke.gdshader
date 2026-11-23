// What rises from a city, one puff per instance on an endless loop (phase in INSTANCE_CUSTOM.x), billboarded.
// INSTANCE_CUSTOM.y = kind: 0 hearth smoke · 1 coal smoke · 2 Symbiont spores · 3 Discarnate data motes · 4 Sovereign smog.
// COLOR.a = 0 hides a puff (its city is out of sight).
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;

// per kind: hearth, coal, spores, motes, smog
const float SPEED[5] = float[5](0.22, 0.16, 0.12, 0.3, 0.1);
const float HEIGHT[5] = float[5](0.75, 1.3, 1.1, 1.4, 1.8);
const float SIZE[5] = float[5](0.42, 0.6, 0.07, 0.05, 0.85);
const vec3 TONE[5] = vec3[5](vec3(0.86, 0.84, 0.8), vec3(0.34, 0.33, 0.33), vec3(0.0), vec3(0.0), vec3(0.2, 0.19, 0.18));

varying float life;
varying float shown;
varying float kind;
varying float seed;

void vertex() {
	kind = INSTANCE_CUSTOM.y;
	seed = INSTANCE_CUSTOM.x;
	shown = COLOR.a;
	int k = clamp(int(round(kind)), 0, 4);
	bool floaty = k == 2 || k == 3;
	life = fract(TIME * SPEED[k] + seed);
	float height = HEIGHT[k];
	vec3 drift = vec3(life * 0.35, 0.0, life * 0.12);
	if (floaty) drift = vec3(0.0);
	vec3 origin = MODEL_MATRIX[3].xyz + drift + vec3(0.0, life * height, 0.0);
	float wander = 0.04;
	if (k == 2) wander = 0.25;
	if (k == 3) wander = 0.12;
	origin.x += sin(TIME * 0.9 + seed * 12.0) * wander * life;
	if (floaty) origin.z += cos(TIME * 0.7 + seed * 9.0) * wander * life;
	float size = mix(0.1, SIZE[k], sqrt(life));
	if (k == 2) size = 0.07 + 0.03 * sin(TIME * 3.0 + seed * 20.0);
	if (k == 3) size = 0.05;
	vec3 right = INV_VIEW_MATRIX[0].xyz;
	vec3 up = INV_VIEW_MATRIX[1].xyz;
	vec3 world = origin + (right * VERTEX.x + up * VERTEX.y) * size;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(world, 1.0);
}

void fragment() {
	int k = clamp(int(round(kind)), 0, 4);
	float r = length(UV - 0.5) * 2.0;
	float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.45, 1.0, life));
	if (k == 2) {
		// spores: soft glowing orbs, teal shading to rose
		vec3 c = mix(vec3(0.35, 1.0, 0.75), vec3(1.0, 0.55, 0.95), fract(seed * 3.7));
		ALBEDO = c * 1.15;
		ALPHA = (1.0 - smoothstep(0.0, 1.0, r)) * fade * shown;
	} else if (k == 3) {
		// data motes: hard-edged violet glints that flicker
		vec2 q = abs(UV - 0.5) * 2.0;
		float sq = 1.0 - step(0.7, max(q.x, q.y));
		float flick = step(0.35, fract(sin(floor(TIME * 8.0) + seed * 91.0) * 43758.5));
		ALBEDO = vec3(0.72, 0.55, 1.0) * 2.2;
		ALPHA = sq * fade * flick * shown;
	} else {
		float puff = 1.0 - smoothstep(0.35, 1.0, r);
		ALBEDO = TONE[k] * (0.92 + 0.08 * (1.0 - r));
		ALPHA = puff * fade * (k == 0 ? 0.7 : 0.85) * shown;
	}
}
