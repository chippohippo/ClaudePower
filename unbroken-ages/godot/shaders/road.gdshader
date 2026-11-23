// Roads draped on the landscape. Early eras: a packed-earth track, darker in the wheel ruts, its edges trodden into the grass
// (soft and ragged). Industrial era on: an asphalt road with a dashed centre line and pale kerbs.
// UV.x runs across the road (0 → 1), UV.y along it (world units).
// Roads on remembered (fogged) tiles are drawn in the same sepia ink as the land around them.
shader_type spatial;
render_mode diffuse_burley, cull_disabled, depth_draw_opaque;

#include "res://shaders/hexmap.gdshaderinc"

uniform sampler2D noise : filter_linear_mipmap, repeat_enable;
varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
uniform bool paved = false;

void fragment() {
	float across = abs(UV.x - 0.5) * 2.0;
	float n = texture(noise, vec2(UV.y * 0.35, UV.x * 0.5)).g;
	float n2 = texture(noise, vec2(UV.y * 2.1, UV.x * 1.7)).r;
	vec3 c;
	float edge;
	if (paved) {
		c = vec3(0.2, 0.2, 0.22) * (0.9 + 0.2 * n);
		float dash = step(0.5, fract(UV.y * 1.6)) * (1.0 - smoothstep(0.05, 0.09, across));
		c = mix(c, vec3(0.95, 0.86, 0.55), dash);
		c = mix(c, vec3(0.72, 0.7, 0.66), smoothstep(0.78, 0.86, across));
		edge = 1.0 - smoothstep(0.92, 1.0, across);
	} else {
		c = vec3(0.42, 0.31, 0.19) * (0.8 + 0.35 * n2);
		float ruts = smoothstep(0.1, 0.0, abs(across - 0.42)) * 0.3;
		c *= 1.0 - ruts;
		c = mix(c, vec3(0.6, 0.5, 0.33), smoothstep(0.35, 0.0, across) * 0.35);   // the crown of the track, worn pale
		edge = 1.0 - smoothstep(0.55, 1.0, across + (n - 0.5) * 0.45);
	}
	int fog = channel(tile_at(axial_round(world_to_axial(wpos.xz))).g);
	if (fog == 1) c = sepia_drawing(c, wpos.xz);
	ALBEDO = c;
	ALPHA = fog == 2 ? 0.0 : edge;
	ROUGHNESS = paved ? 0.65 : 0.95;
}
