// Edge rivers: a narrow ribbon of moving water laid on the ground, with soft muddy banks fading into the terrain and
// slow streaks drifting downstream. UV.x runs across the ribbon (0 bank → 1 bank), UV.y along it.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled, depth_draw_opaque;

uniform sampler2D noise : filter_linear_mipmap, repeat_enable;
uniform vec3 water : source_color = vec3(0.10, 0.45, 0.6);
uniform vec3 bank : source_color = vec3(0.30, 0.26, 0.17);

void fragment() {
	float across = abs(UV.x - 0.5) * 2.0;                     // 0 mid-stream, 1 at the banks
	float flow = texture(noise, vec2(UV.y * 0.6 - TIME * 0.08, UV.x * 0.4)).g;
	vec3 c = mix(water * (0.85 + 0.35 * flow), bank, smoothstep(0.55, 0.95, across));
	ALBEDO = c;
	ALPHA = 1.0 - smoothstep(0.75, 1.0, across);
	ROUGHNESS = mix(0.08, 0.9, smoothstep(0.5, 0.9, across));
	SPECULAR = 0.5;
}
