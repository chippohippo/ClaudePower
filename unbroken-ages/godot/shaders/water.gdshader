// Water: two scrolling procedural normal maps, depth colour by tile kind (coast turquoise, ocean deep blue, lakes and
// Great River channels fresh blue-green), sky reflections from the HDRI, soft foam toward the hex rim, and the same fog.
//   INSTANCE_CUSTOM.x = 0 coast · 1 ocean · 2 lake/channel, .y = fog (as terrain), .z = random seed.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform sampler2D wave_a : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D wave_b : hint_normal, filter_linear_mipmap, repeat_enable;
uniform vec3 coast_color : source_color = vec3(0.05, 0.28, 0.36);
uniform vec3 ocean_color : source_color = vec3(0.02, 0.09, 0.2);
uniform vec3 fresh_color : source_color = vec3(0.06, 0.3, 0.36);
uniform vec3 parchment = vec3(0.40, 0.35, 0.26);

varying vec3 wpos;
varying vec3 center;
varying vec4 custom;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	center = MODEL_MATRIX[3].xyz;
	custom = INSTANCE_CUSTOM;
}

void fragment() {
	vec2 uv = wpos.xz * 0.11;
	vec3 n1 = texture(wave_a, uv + TIME * vec2(0.010, 0.006)).rgb;
	vec3 n2 = texture(wave_b, uv * 1.7 - TIME * vec2(0.007, 0.012)).rgb;
	vec3 col = custom.x < 0.5 ? coast_color : (custom.x < 1.5 ? ocean_color : fresh_color);
	float fresnel = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	col = mix(col, col * 1.25 + vec3(0.02), fresnel);
	float fog = custom.y;
	if (fog > 0.5 && fog < 1.5) {
		float l = dot(col, vec3(0.3, 0.59, 0.11));
		col = vec3(l) * vec3(0.95, 0.9, 0.78) * 0.9;
	} else if (fog >= 1.5) {
		col = parchment * 0.85;
	}
	ALBEDO = col;
	NORMAL_MAP = fog >= 1.5 ? vec3(0.5, 0.5, 1.0) : normalize(mix(n1, n2, 0.5));
	NORMAL_MAP_DEPTH = 0.55;
	ROUGHNESS = fog >= 1.5 ? 0.9 : 0.12;
	METALLIC = 0.0;
	SPECULAR = fog >= 1.5 ? 0.1 : 0.5;
}
