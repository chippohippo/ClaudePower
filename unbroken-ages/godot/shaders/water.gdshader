// Water, Civ VI-style, as a real surface over the landscape: it reads the depth buffer, so the shallows show the sand
// beneath and turn turquoise, deep water goes to navy, and foam forms wherever water meets land: coasts, islands,
// river banks. Animated normals and drifting swell; sky reflections. Paper-map fog as everywhere else.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, depth_draw_always, cull_disabled;

#include "res://shaders/hexmap.gdshaderinc"

uniform sampler2D depth_tex : hint_depth_texture, filter_linear_mipmap;
uniform sampler2D wave_a : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D wave_b : hint_normal, filter_linear_mipmap, repeat_enable;
uniform vec3 shallow_color : source_color = vec3(0.16, 0.66, 0.66);
uniform vec3 coast_color : source_color = vec3(0.06, 0.42, 0.52);
uniform vec3 ocean_color : source_color = vec3(0.02, 0.13, 0.30);
uniform vec3 foam_color : source_color = vec3(0.93, 0.96, 0.92);

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 wp = wpos.xz;
	// how much water lies between the surface and the ground behind it
	float scene = texture(depth_tex, SCREEN_UV).r;
	vec4 view = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, scene, 1.0);
	view.xyz /= view.w;
	float depth = max(0.0, (-view.z) - (-VERTEX.z)) * 0.55;

	float swell = texture(paper_noise, wp * 0.12 + vec2(TIME * 0.006, TIME * 0.004)).r;
	vec3 col = mix(shallow_color, coast_color, smoothstep(0.0, 0.18, depth));
	col = mix(col, ocean_color, smoothstep(0.18, 0.55, depth));
	col *= 0.9 + 0.2 * smoothstep(0.45, 0.85, swell);

	// foam: a broken line where water meets land, and bands of surf rolling in
	float breakup = texture(paper_noise, wp * 1.3 + TIME * 0.02).g;
	float shore = 1.0 - smoothstep(0.0, 0.05 + breakup * 0.04, depth);
	float bands = smoothstep(0.8, 0.97, sin(depth * 40.0 - TIME * 1.8 + swell * 5.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.04, 0.2, depth));
	float foam = clamp(shore + bands * 0.6 * smoothstep(0.3, 0.6, breakup), 0.0, 1.0);
	col = mix(col, foam_color, foam * 0.9);
	float alpha = mix(0.35, 0.96, smoothstep(0.0, 0.3, depth));
	alpha = max(alpha, foam * 0.95);

	vec2 a = axial_round(world_to_axial(wp));
	int fog = channel(tile_at(a).g);
	vec3 n1 = texture(wave_a, wp * 0.11 + TIME * vec2(0.010, 0.006)).rgb;
	vec3 n2 = texture(wave_b, wp * 0.19 - TIME * vec2(0.007, 0.012)).rgb;
	if (fog == 1) { col = sepia_drawing(col * 0.8, wp); alpha = max(alpha, 0.85); }
	else if (fog == 2) { col = paper(wp); alpha = 1.0; }
	ALBEDO = col;
	ALPHA = alpha;
	NORMAL_MAP = fog == 0 ? normalize(mix(n1, n2, 0.5)) : vec3(0.5, 0.5, 1.0);
	NORMAL_MAP_DEPTH = 0.5;
	ROUGHNESS = fog == 0 ? 0.08 : 1.0;
	SPECULAR = fog == 0 ? 0.5 : 0.05;
}
