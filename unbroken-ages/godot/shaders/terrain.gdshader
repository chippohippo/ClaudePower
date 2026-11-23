// Hex terrain: tiling aerial PBR textures (Poly Haven, CC0) chosen per tile from a texture array, cliff texture on the
// sides, a soft painted hex edge (Civ-style grid you read without noticing), and the fog of war:
//   INSTANCE_CUSTOM.x = texture layer, .y = 0 visible · 1 remembered (sepia map) · 2 unexplored (parchment), .z = random seed.
// The instance colour tints the top (terrain identity: lush grassland, golden plains, pale tundra...).
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform sampler2DArray albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tiling = 0.32;
uniform int cliff_layer = 6;
uniform vec3 parchment = vec3(0.36, 0.30, 0.21);
uniform vec3 parchment_ink = vec3(0.16, 0.11, 0.07);

varying vec3 wpos;
varying vec3 wnormal;
varying vec3 center;
varying vec4 custom;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	center = MODEL_MATRIX[3].xyz;
	custom = INSTANCE_CUSTOM;
}

float hex_dist(vec2 p) {
	// distance to the centre in "apothem units" for a pointy-top hex (flat sides face ±x and the two diagonals)
	vec2 a = abs(p);
	return max(a.x, dot(a, vec2(0.5, 0.8660254)));
}

void fragment() {
	vec4 tint = COLOR;
	bool top = wnormal.y > 0.6;
	float layer = custom.x;
	vec2 uv_top = wpos.xz * tiling + vec2(custom.z * 0.37, custom.z * 0.61);   // break up repetition per tile
	vec3 uvw = top ? vec3(uv_top, layer) : vec3(vec2(wpos.x * 0.7 + wpos.z * 0.7, wpos.y * 1.4) * tiling * 2.0, float(cliff_layer));
	vec3 albedo = texture(albedo_tex, uvw).rgb;
	if (top) albedo = mix(albedo, albedo * tint.rgb * 1.45, 0.8);
	else albedo *= vec3(0.72, 0.66, 0.6);

	// painted hex edge: a darker rim and a slightly lighter inner band, like a hand-drawn board
	float d = hex_dist((wpos.xz - center.xz)) / 0.84;
	float rim = smoothstep(0.90, 0.985, d);
	if (top) albedo *= 1.0 - 0.28 * rim;

	float fog = custom.y;
	if (fog > 0.5 && fog < 1.5) {
		float l = dot(albedo, vec3(0.3, 0.59, 0.11));
		albedo = mix(vec3(l) * vec3(1.05, 0.92, 0.72), albedo, 0.18) * 0.82;   // remembered: a sepia map of what was there
	} else if (fog >= 1.5) {
		float grain = texture(albedo_tex, vec3(wpos.xz * 0.08, 1.0)).r;
		albedo = parchment * (0.9 + 0.15 * grain);
		albedo = mix(albedo, parchment_ink, smoothstep(0.93, 0.985, d) * 0.7);  // inked hex outline on old paper
	}
	ALBEDO = albedo;
	NORMAL_MAP = fog >= 1.5 ? vec3(0.5, 0.5, 1.0) : texture(normal_tex, uvw).rgb;
	NORMAL_MAP_DEPTH = top ? 1.0 : 1.6;
	ROUGHNESS = 0.92;
	SPECULAR = 0.25;
}
