// Water, Civ VI-style: deep ocean blue, bright turquoise shallows along coasts, fresh blue-green lakes and Great Rivers,
// animated shore lines that roll in toward the land, foam on the shoreline, stylised wave glints on open sea, and the
// paper-map fog (sepia memory, parchment beyond the known world).
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/hexmap.gdshaderinc"

uniform sampler2D wave_a : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D wave_b : hint_normal, filter_linear_mipmap, repeat_enable;
uniform vec3 coast_color : source_color = vec3(0.08, 0.52, 0.58);
uniform vec3 ocean_color : source_color = vec3(0.03, 0.16, 0.34);
uniform vec3 fresh_color : source_color = vec3(0.07, 0.40, 0.46);
uniform vec3 foam_color : source_color = vec3(0.92, 0.95, 0.9);

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

vec3 depth_color(vec4 d) {
	int w = channel(d.b);
	return w == 2 ? ocean_color : (w == 3 ? fresh_color : coast_color);
}

void fragment() {
	vec2 wp = wpos.xz;
	vec2 a, b;
	float edge;
	hex_pair(wobble(wp, 0.7), a, b, edge);
	vec4 da = tile_at(a);
	vec4 db = tile_at(b);
	bool shore = channel(db.b) == 0 && channel(db.g) < 2;
	float wa = 0.5 + 0.5 * smoothstep(0.0, 0.45, edge);
	vec3 col = mix(shore ? coast_color * 1.35 : depth_color(db), depth_color(da), wa);

	// stylised swell: lighter crests drifting across open water
	float swell = texture(paper_noise, wp * 0.12 + vec2(TIME * 0.006, TIME * 0.004)).r;
	col *= 0.9 + 0.22 * smoothstep(0.45, 0.85, swell);

	// shore: bands of surf rolling toward the land, then a line of foam on the sand
	if (shore) {
		float near = 1.0 - smoothstep(0.0, 0.5, edge);
		float bands = smoothstep(0.75, 0.95, sin(edge * 26.0 + TIME * 1.6 + swell * 4.0) * 0.5 + 0.5);
		float foam = (1.0 - smoothstep(0.0, 0.08, edge)) + bands * near * 0.55;
		float breakup = texture(paper_noise, wp * 1.3 + TIME * 0.02).g;
		col = mix(col, foam_color, clamp(foam * smoothstep(0.25, 0.6, breakup + near * 0.4), 0.0, 1.0) * 0.85);
	}

	int fog = channel(da.g);
	vec3 n1 = texture(wave_a, wp * 0.11 + TIME * vec2(0.010, 0.006)).rgb;
	vec3 n2 = texture(wave_b, wp * 0.19 - TIME * vec2(0.007, 0.012)).rgb;
	if (fog == 1) col = sepia_drawing(col * 0.8, wp);
	else if (fog == 2) col = paper(wp);
	if (fog == 0 && channel(db.g) == 2) col = mix(col, paper(wp), 1.0 - smoothstep(0.0, 0.3, edge));
	ALBEDO = col;
	NORMAL_MAP = fog == 0 ? normalize(mix(n1, n2, 0.5)) : vec3(0.5, 0.5, 1.0);
	NORMAL_MAP_DEPTH = 0.5;
	ROUGHNESS = fog == 0 ? 0.1 : 1.0;
	SPECULAR = fog == 0 ? 0.45 : 0.05;
}
