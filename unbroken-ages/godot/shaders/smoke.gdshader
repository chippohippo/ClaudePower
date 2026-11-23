// Chimney smoke: each instance is one puff on an endless loop (phase in INSTANCE_CUSTOM.x). It rises, drifts downwind,
// swells and fades; billboarded toward the camera. INSTANCE_CUSTOM.y = 1 for coal smoke (industrial, darker, taller).
// COLOR.a = 0 hides a puff (its city is out of sight).
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;

varying float life;
varying float shown;
varying float coal;

void vertex() {
	coal = INSTANCE_CUSTOM.y;
	float speed = mix(0.22, 0.16, coal);
	life = fract(TIME * speed + INSTANCE_CUSTOM.x);
	shown = COLOR.a;
	float height = mix(0.75, 1.3, coal);
	vec3 origin = MODEL_MATRIX[3].xyz + vec3(life * 0.35, life * height, life * 0.12);
	origin.x += sin(TIME * 0.9 + INSTANCE_CUSTOM.x * 12.0) * 0.04 * life;
	float size = mix(0.1, mix(0.42, 0.6, coal), sqrt(life));
	vec3 right = INV_VIEW_MATRIX[0].xyz;
	vec3 up = INV_VIEW_MATRIX[1].xyz;
	vec3 world = origin + (right * VERTEX.x + up * VERTEX.y) * size;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(world, 1.0);
}

void fragment() {
	float r = length(UV - 0.5) * 2.0;
	float puff = 1.0 - smoothstep(0.35, 1.0, r);
	float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.45, 1.0, life));
	vec3 tone = mix(vec3(0.86, 0.84, 0.8), vec3(0.34, 0.33, 0.33), coal);
	ALBEDO = tone * (0.92 + 0.08 * (1.0 - r));
	ALPHA = puff * fade * mix(0.7, 0.85, coal) * shown;
}
