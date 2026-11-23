// Full-screen finish, applied after the whole 3D frame (including water and other transparent surfaces) and before the
// interface: fine paper grain, a warm Civ VI grade (golden highlights) and a vignette that ages toward sepia at the
// corners like the edges of an old chart.
shader_type canvas_item;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D paper_noise : filter_linear_mipmap, repeat_enable;
uniform float grain = 0.08;
uniform float vignette = 0.65;
uniform float warmth = 0.07;

void fragment() {
	vec3 c = textureLod(screen_tex, SCREEN_UV, 0.0).rgb;
	float aspect = SCREEN_PIXEL_SIZE.y / SCREEN_PIXEL_SIZE.x;
	vec2 puv = SCREEN_UV * vec2(aspect, 1.0);
	float fibre = texture(paper_noise, puv * 2.2).b;
	float speck = texture(paper_noise, puv * 7.0 + 0.3).g;
	c *= 1.0 - grain * 0.5 + grain * (fibre * 0.7 + speck * 0.3);
	float l = dot(c, vec3(0.3, 0.59, 0.11));
	c = mix(c, c * vec3(1.05, 1.0, 0.9), warmth * 4.0 * smoothstep(0.15, 0.9, l));
	vec2 d = (SCREEN_UV - 0.5) * vec2(aspect, 1.0);
	float v = smoothstep(0.4, 1.0, length(d));
	c = mix(c, vec3(l) * vec3(1.05, 0.92, 0.7) * 0.72, v * vignette);
	COLOR = vec4(c, 1.0);
}
