// Clouds drifting between the camera and the world, seen only from far up (the strategic view); they thin and part as the
// camera comes down. Two octaves of the shared paper noise, scrolled by the wind.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D noise : filter_linear_mipmap, repeat_enable;
uniform float opacity = 0.0;

varying vec3 wpos;

void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec2 wp = wpos.xz;
	float n = texture(noise, wp * 0.008 + TIME * vec2(0.0016, 0.0009)).r * 0.65 + texture(noise, wp * 0.027 + TIME * vec2(0.0035, 0.002)).g * 0.35;
	float a = smoothstep(0.5, 0.78, n);
	ALBEDO = mix(vec3(0.78, 0.8, 0.84), vec3(1.0, 0.99, 0.96), smoothstep(0.55, 0.85, n));
	ALPHA = a * 0.78 * opacity;
}
