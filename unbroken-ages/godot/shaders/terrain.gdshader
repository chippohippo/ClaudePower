// Terrain, Civ VI-style on an old paper map.
// Visible land: aerial PBR textures (Poly Haven, CC0) per terrain, softened toward a painted look, with large colour
// variation that hides tiling, and soft wobbly borders between terrains; beaches where land meets water.
// Remembered land: a sepia ink drawing on parchment. Unexplored: parchment with an inked hex grid and stains.
// The frontier between known and unknown gets a burnt ink edge. The sides of land columns show cliff rock.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/hexmap.gdshaderinc"

uniform sampler2DArray albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tiling = 0.3;
uniform vec3 layer_tint[8];

varying vec3 wpos;
varying vec3 wnormal;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

vec3 land_color(vec4 d, vec2 wp) {
	int layer = channel(d.r);
	int water = channel(d.b);
	int feature = channel(d.a);
	if (water > 0) layer = 7;                                   // shore: sand blends into the water edge
	vec2 uv = wp * tiling;
	vec3 sharp = texture(albedo_tex, vec3(uv, float(layer))).rgb;
	vec3 soft = textureLod(albedo_tex, vec3(uv, float(layer)), 4.5).rgb;
	vec3 tex = mix(sharp, soft, 0.45);                          // painterly: less photo noise, more colour
	vec3 col = tex * layer_tint[layer] * 1.55;
	// broad colour variation, like brush strokes laid over a landscape painting
	vec3 macro = texture(paper_noise, wp * 0.035).rgb;
	col *= 0.86 + 0.28 * macro.r;
	col = mix(col, col * vec3(1.06, 1.08, 0.86), macro.g * 0.5);
	if (feature == 1) col = mix(col, vec3(0.42, 0.55, 0.24), 0.45);
	else if (feature == 2) col = mix(col, vec3(0.25, 0.33, 0.24), 0.5);
	else if (feature == 3) col = mix(vec3(0.72, 0.34, 0.80), vec3(0.24, 0.78, 0.6), macro.b);
	else if (feature == 4) col = mix(col, vec3(0.28, 0.5, 0.62), 0.45);
	else if (feature == 5) col *= 0.62;
	else if (feature == 6) col = mix(col, vec3(0.4, 0.62, 0.3), 0.4);
	else if (feature == 7) col = mix(col, vec3(0.8, 0.83, 0.86), 0.7);
	else if (feature == 8) col = mix(col, vec3(0.1, 0.09, 0.15), 0.8);
	return col;
}

vec3 look(vec4 d, vec2 wp) {
	int fog = channel(d.g);
	if (fog == 2) return paper(wp);
	vec3 c = land_color(d, wp);
	return fog == 1 ? sepia_drawing(c, wp) : c;
}

void fragment() {
	vec2 wp = wpos.xz;
	bool top = wnormal.y > 0.6;
	vec2 a, b;
	float edge;
	hex_pair(wobble(wp, 0.9), a, b, edge);
	vec4 da = tile_at(a);
	vec4 db = tile_at(b);
	float wa = 0.5 + 0.5 * smoothstep(0.0, 0.34, edge);
	vec3 col = mix(look(db, wp), look(da, wp), wa);
	int fa = channel(da.g), fb = channel(db.g);
	vec3 normal_ts = texture(normal_tex, vec3(wp * tiling, float(channel(da.r)))).rgb;

	// the true hex grid (not wobbled): a faint pencil line on land, a firm ink grid on the parchment
	vec2 ga, gb;
	float gedge;
	hex_pair(wp, ga, gb, gedge);
	int fog_here = channel(tile_at(ga).g);
	float line = 1.0 - smoothstep(0.0, fog_here == 0 ? 0.03 : 0.045, gedge);
	float pen = 0.75 + 0.25 * texture(paper_noise, wp * 2.3).g;   // ink that varies like a real pen line
	col = mix(col, fog_here == 0 ? col * 0.7 : ink_color, line * (fog_here == 0 ? 0.25 : 0.6) * pen);

	// the frontier of the known world: a burnt, inked edge on the paper
	if (fa != fb && (fa == 2 || fb == 2)) {
		float ragged = texture(paper_noise, wp * 1.6).r * 0.12;
		float burn = 1.0 - smoothstep(0.0, 0.2 + ragged, edge);
		col = mix(col, ink_color * 0.75, burn * 0.7);
		col = mix(col, col * vec3(0.8, 0.62, 0.42), (1.0 - smoothstep(0.0, 0.6, edge)) * (fa == 2 ? 0.5 : 0.0));   // scorched paper
	}

	if (!top) {
		vec2 side_uv = vec2(wpos.x * 0.7 + wpos.z * 0.7, wpos.y * 1.4) * tiling * 2.0;
		vec3 cliff = texture(albedo_tex, vec3(side_uv, 6.0)).rgb * vec3(0.78, 0.7, 0.6);
		col = fa == 0 ? cliff : (fa == 1 ? sepia_drawing(cliff, wp) : paper(wp) * 0.85);
		normal_ts = texture(normal_tex, vec3(side_uv, 6.0)).rgb;
	}
	ALBEDO = col;
	NORMAL_MAP = fa == 0 ? normal_ts : vec3(0.5, 0.5, 1.0);
	NORMAL_MAP_DEPTH = top ? 0.9 : 1.5;
	ROUGHNESS = fa == 0 ? 0.92 : 1.0;
	SPECULAR = fa == 0 ? 0.25 : 0.05;
}
