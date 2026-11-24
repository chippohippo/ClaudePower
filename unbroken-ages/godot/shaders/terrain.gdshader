// The landscape, Civ VI-style on an old paper map, drawn on a continuous height-mapped mesh.
// Visible land: aerial PBR textures (Poly Haven, CC0) per terrain, softened toward a painted look, broad colour variation,
// soft wobbly borders between terrains; rock on steep slopes, snow on high peaks, sand where the ground meets the sea, a
// wet sandy seabed under shallow water, and drifting cloud shadows. Remembered land: a sepia watercolour on parchment.
// Unexplored: parchment with an inked hex grid. The frontier between known and unknown is a burnt ink edge.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/hexmap.gdshaderinc"

uniform sampler2DArray albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tiling = 0.3;
uniform vec3 layer_tint[8];
uniform float cloud_shadows = 0.22;

varying vec3 wpos;
varying vec3 wnormal;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

vec3 layer_color(int layer, vec2 wp) {
	vec2 uv = wp * tiling;
	vec3 sharp = texture(albedo_tex, vec3(uv, float(layer))).rgb;
	vec3 soft = textureLod(albedo_tex, vec3(uv, float(layer)), 4.5).rgb;
	return mix(sharp, soft, 0.45) * layer_tint[layer] * 1.55;    // painterly: less photo noise, more colour
}

float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Worked land seen from the air: a patchwork of crop plots with furrows and hedgerows (farms), rows of trees (plantations),
// fenced paddocks (pastures), a golden haze of wild grain (unimproved wheat).
vec3 fields(vec3 col, vec2 wp, int kind, vec3 macro) {
	float an = 0.45 + floor(wp.x * 0.25 + wp.y * 0.17) * 0.6;       // plots change heading every few tiles
	mat2 rot = mat2(vec2(cos(an), sin(an)), vec2(-sin(an), cos(an)));
	vec2 r = rot * wp;
	if (kind == 12) return mix(col, vec3(0.8, 0.66, 0.3), 0.5 + 0.2 * macro.g);
	vec2 scale = vec2(1.7, 2.6);
	if (kind == 11) scale = vec2(1.1, 1.3);
	vec2 cell = floor(r * scale);
	vec2 f = fract(r * scale);
	float h = hash21(cell);
	float border = min(min(f.x, 1.0 - f.x) / scale.x, min(f.y, 1.0 - f.y) / scale.y);
	vec3 plot;
	if (kind == 9) {
		plot = vec3(0.48, 0.35, 0.21);                                   // ploughed
		if (h < 0.3) plot = vec3(0.83, 0.66, 0.27);                      // ripe grain
		else if (h < 0.55) plot = vec3(0.5, 0.62, 0.22);                 // green crop
		else if (h < 0.8) plot = vec3(0.64, 0.7, 0.3);                   // young crop
		float furrow = 0.5 + 0.5 * sin((h < 0.5 ? r.x : r.y) * 70.0);
		plot *= 0.86 + 0.16 * furrow;
		plot *= 0.92 + 0.16 * macro.b;
		col = mix(col, plot, 0.9);
		col = mix(col, vec3(0.2, 0.3, 0.12), smoothstep(0.035, 0.012, border) * 0.85);   // hedgerows
	} else if (kind == 10) {
		vec2 g = fract(r * 7.0) - 0.5;
		float tree = smoothstep(0.32, 0.18, length(g));
		col = mix(col * 0.9, vec3(0.5, 0.58, 0.3), 0.5);
		col = mix(col, vec3(0.17, 0.3, 0.11) * (0.85 + 0.3 * h), tree * 0.85);
	} else {
		col = mix(col, vec3(0.46, 0.62, 0.27) * (0.9 + 0.2 * h), 0.6);
		col = mix(col, vec3(0.42, 0.3, 0.18), smoothstep(0.02, 0.008, border) * 0.9);     // fences
	}
	return col;
}

vec3 land_color(vec4 d, vec2 wp) {
	int layer = channel(d.r);
	int feature = channel(d.a);
	vec3 col = layer_color(layer, wp);
	vec3 macro = texture(paper_noise, wp * 0.035).rgb;           // brush-stroke colour variation over the landscape
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
	else if (feature >= 9) col = fields(col, wp, feature, macro);
	return col;
}

// Shape-driven colour: the ground's slope and height override the tile's surface where nature would.
vec3 shaped(vec3 col, vec2 wp, float y, float slope) {
	float n = texture(paper_noise, wp * 0.7).g;
	vec3 rock = layer_color(5, wp);
	col = mix(col, rock, smoothstep(0.32, 0.58, slope + (n - 0.5) * 0.15));       // bare rock on steep faces
	float snow_line = 0.95 + (n - 0.5) * 0.35;
	col = mix(col, layer_color(4, wp) * 1.05, smoothstep(snow_line, snow_line + 0.18, y) * (1.0 - smoothstep(0.55, 0.8, slope)));
	float beach = 1.0 - smoothstep(0.04, 0.13 + n * 0.05, y);                      // sand where land meets the sea
	col = mix(col, layer_color(7, wp), beach);
	if (y < 0.0) col = mix(col, layer_color(7, wp) * vec3(0.62, 0.66, 0.6), smoothstep(0.0, -0.1, y));   // wet seabed
	return col;
}

vec3 look(vec4 d, vec2 wp, float y, float slope) {
	int fog = channel(d.g);
	if (fog == 2) return paper(wp);
	vec3 c = shaped(land_color(d, wp), wp, y, slope);
	if (channel(d.a) == 13) {
		// Inca terraces: green steps cut along the contours of owned hills and mountains, stone risers between them.
		float band = fract(y * 7.0 + texture(paper_noise, wp * 0.3).r * 0.25);
		float riser = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.82, 0.9, band));
		vec3 field = mix(vec3(0.36, 0.5, 0.2), vec3(0.55, 0.6, 0.28), texture(paper_noise, wp * 1.3).g);
		float steep = smoothstep(0.75, 0.95, slope);
		c = mix(c, mix(vec3(0.42, 0.38, 0.32), field, riser), (1.0 - steep) * 0.85 * smoothstep(0.05, 0.2, y));
	}
	return fog == 1 ? sepia_drawing(c, wp) : c;
}

void fragment() {
	vec2 wp = wpos.xz;
	float slope = 1.0 - clamp(wnormal.y, 0.0, 1.0);
	vec2 a, b;
	float edge;
	hex_pair(wobble(wp, 0.9), a, b, edge);
	vec4 da = tile_at(a);
	vec4 db = tile_at(b);
	float wa = 0.5 + 0.5 * smoothstep(0.0, 0.34, edge);
	vec3 col = mix(look(db, wp, wpos.y, slope), look(da, wp, wpos.y, slope), wa);
	int fa = channel(da.g), fb = channel(db.g);
	int normal_layer = slope > 0.45 ? 5 : channel(da.r);
	vec3 normal_ts = texture(normal_tex, vec3(wp * tiling, float(normal_layer))).rgb;

	// the true hex grid (not wobbled): a faint pencil line on land, a firm ink grid on the parchment
	vec2 ga, gb;
	float gedge;
	hex_pair(wp, ga, gb, gedge);
	int fog_here = channel(tile_at(ga).g);
	float line = 1.0 - smoothstep(0.0, fog_here == 0 ? 0.03 : 0.045, gedge);
	float pen = 0.75 + 0.25 * texture(paper_noise, wp * 2.3).g;
	if (wpos.y > 0.0 || fog_here != 0) col = mix(col, fog_here == 0 ? col * 0.72 : ink_color, line * (fog_here == 0 ? 0.22 : 0.6) * pen);

	// the frontier of the known world: a ragged, burnt ink edge on the paper
	if (fa != fb && (fa == 2 || fb == 2)) {
		float ragged = texture(paper_noise, wp * 1.6).r * 0.12;
		float burn = 1.0 - smoothstep(0.0, 0.2 + ragged, edge);
		col = mix(col, ink_color * 0.75, burn * 0.7);
		col = mix(col, col * vec3(0.8, 0.62, 0.42), (1.0 - smoothstep(0.0, 0.6, edge)) * (fa == 2 ? 0.5 : 0.0));
	}

	// cloud shadows drifting over the visible world
	if (fa == 0) {
		float cloud = texture(paper_noise, wp * 0.022 + vec2(TIME * 0.004, TIME * 0.0025)).r;
		col *= 1.0 - cloud_shadows * smoothstep(0.52, 0.72, cloud);
	}
	ALBEDO = col;
	NORMAL_MAP = fa == 0 ? normal_ts : vec3(0.5, 0.5, 1.0);
	NORMAL_MAP_DEPTH = 0.9;
	ROUGHNESS = fa == 0 ? mix(0.92, 0.55, step(wpos.y, 0.0)) : 1.0;
	SPECULAR = fa == 0 ? 0.25 : 0.05;
}
