// Full-screen finish: the whole view sits on paper. Fine paper grain, warm Civ VI grading (golden light, rich colour),
// and a vignette that ages toward sepia at the corners, like the edges of an old chart. Drawn on a quad in front of
// the camera, so the interface (drawn later on a CanvasLayer) stays crisp.
shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, skip_vertex_transform, fog_disabled;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D paper_noise : filter_linear_mipmap, repeat_enable;
uniform float grain = 0.07;
uniform float vignette = 0.7;
uniform float warmth = 0.08;

void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 0.0, 1.0);
}

void fragment() {
	vec3 c = textureLod(screen_tex, SCREEN_UV, 0.0).rgb;
	float aspect = VIEWPORT_SIZE.x / VIEWPORT_SIZE.y;
	vec2 puv = SCREEN_UV * vec2(aspect, 1.0);
	float fibre = texture(paper_noise, puv * 2.2).b;
	float speck = texture(paper_noise, puv * 7.0 + 0.3).g;
	c *= 1.0 - grain * 0.5 + grain * (fibre * 0.7 + speck * 0.3);
	// warm grade: golden highlights, cool-free shadows
	float l = dot(c, vec3(0.3, 0.59, 0.11));
	c = mix(c, c * vec3(1.06, 1.0, 0.88), warmth * 4.0 * smoothstep(0.1, 0.9, l));
	// vignette toward aged paper
	vec2 d = (SCREEN_UV - 0.5) * vec2(aspect, 1.0);
	float v = smoothstep(0.38, 1.0, length(d));
	vec3 sepia = vec3(l) * vec3(1.08, 0.94, 0.72);
	c = mix(c, sepia * 0.75, v * vignette);
	ALBEDO = c;
}
