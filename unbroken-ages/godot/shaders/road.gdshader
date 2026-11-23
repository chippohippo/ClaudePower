// Roads draped on the landscape, built to the owner's technology (TechLook.RoadKind, the `style` uniform):
//   0 footpath   a faint trodden line in the grass
//   1 track      packed earth with wheel ruts and soft trodden edges
//   2 stone      a cobbled road with kerbstones (Engineering)
//   3 macadam    grey crushed stone, tar-dark centre (Industrialization)
//   4 asphalt    black-top with a dashed centre line and pale kerbs (Refining)
//   5 smart      asphalt with glowing cyan lane lights running along it (Robotics)
//   6 sovereign  a broad white concrete highway, expansion joints, blue edge lights (destructive)
//   7 symbiont   a mossy living path veined with pulsing bioluminescence (harmonized)
//   8 discarnate a black glass conduit with violet data pulses racing along it (syncretic)
// Roads on remembered (fogged) tiles are drawn in the same sepia ink as the land around them.
// UV.x runs across the road (0 → 1), UV.y along it (world units).
shader_type spatial;
render_mode diffuse_burley, cull_disabled, depth_draw_opaque;

#include "res://shaders/hexmap.gdshaderinc"

uniform sampler2D noise : filter_linear_mipmap, repeat_enable;
uniform int style = 1;
varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float across = abs(UV.x - 0.5) * 2.0;
	float n = texture(noise, vec2(UV.y * 0.35, UV.x * 0.5)).g;
	float n2 = texture(noise, vec2(UV.y * 2.1, UV.x * 1.7)).r;
	vec3 c = vec3(0.4, 0.3, 0.2);
	vec3 glow = vec3(0.0);
	float edge = 1.0 - smoothstep(0.85, 1.0, across);
	float rough = 0.9;
	if (style == 0) {
		c = vec3(0.5, 0.42, 0.3) * (0.85 + 0.3 * n2);
		edge = (1.0 - smoothstep(0.2, 1.0, across + (n - 0.5) * 0.6)) * 0.7;
	} else if (style == 1) {
		c = vec3(0.42, 0.31, 0.19) * (0.8 + 0.35 * n2);
		c *= 1.0 - smoothstep(0.1, 0.0, abs(across - 0.42)) * 0.3;
		c = mix(c, vec3(0.6, 0.5, 0.33), smoothstep(0.35, 0.0, across) * 0.35);
		edge = 1.0 - smoothstep(0.55, 1.0, across + (n - 0.5) * 0.45);
	} else if (style == 2) {
		vec2 cell = vec2(UV.y * 9.0, UV.x * 4.0);
		vec2 f = fract(cell + vec2(floor(cell.y) * 0.5, 0.0));
		float stone = smoothstep(0.0, 0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
		c = mix(vec3(0.3, 0.27, 0.24), vec3(0.62, 0.58, 0.52) * (0.85 + 0.3 * n2), stone);
		c = mix(c, vec3(0.5, 0.47, 0.43), smoothstep(0.8, 0.88, across));
		edge = 1.0 - smoothstep(0.9, 1.0, across);
	} else if (style == 3) {
		c = vec3(0.46, 0.45, 0.43) * (0.8 + 0.35 * n2);
		c = mix(c, vec3(0.25, 0.24, 0.23), smoothstep(0.6, 0.0, across) * 0.6);
		edge = 1.0 - smoothstep(0.82, 1.0, across + (n - 0.5) * 0.2);
	} else if (style == 4 || style == 5) {
		c = vec3(0.2, 0.2, 0.22) * (0.9 + 0.2 * n);
		float dash = step(0.5, fract(UV.y * 1.6)) * (1.0 - smoothstep(0.05, 0.09, across));
		c = mix(c, vec3(0.95, 0.86, 0.55), dash);
		c = mix(c, vec3(0.72, 0.7, 0.66), smoothstep(0.78, 0.86, across));
		edge = 1.0 - smoothstep(0.92, 1.0, across);
		rough = 0.65;
		if (style == 5) {
			float lane = smoothstep(0.06, 0.0, abs(across - 0.5)) * (0.6 + 0.4 * sin(UV.y * 6.0 - TIME * 5.0));
			glow = vec3(0.3, 0.9, 1.0) * lane * 1.6;
			c = mix(c, vec3(0.3, 0.9, 1.0), lane * 0.5);
		}
	} else if (style == 6) {
		c = vec3(0.86, 0.87, 0.88) * (0.92 + 0.12 * n2);
		float joint = smoothstep(0.03, 0.0, abs(fract(UV.y * 2.0) - 0.5)) * 0.25;
		c *= 1.0 - joint;
		c = mix(c, vec3(0.55, 0.57, 0.6), smoothstep(0.9, 0.97, across) - smoothstep(0.97, 1.0, across) * 0.0);
		float rail = smoothstep(0.04, 0.0, abs(across - 0.82));
		glow = vec3(0.45, 0.8, 1.0) * rail * 1.4;
		edge = 1.0 - smoothstep(0.96, 1.0, across);
		rough = 0.5;
	} else if (style == 7) {
		c = mix(vec3(0.22, 0.38, 0.18), vec3(0.4, 0.55, 0.25), n2) * (0.85 + 0.25 * n);
		float vein = smoothstep(0.08, 0.0, abs(sin(UV.y * 3.0 + UV.x * 6.0 + n * 6.0)) - 0.0) * (1.0 - across);
		float pulse = 0.5 + 0.5 * sin(UV.y * 2.0 - TIME * 1.5);
		glow = mix(vec3(0.3, 1.0, 0.7), vec3(1.0, 0.5, 0.95), n) * vein * pulse * 1.3;
		edge = 1.0 - smoothstep(0.45, 1.0, across + (n - 0.5) * 0.5);
	} else {
		c = vec3(0.06, 0.05, 0.1) + vec3(0.08, 0.06, 0.14) * n2;
		float rib = smoothstep(0.05, 0.0, abs(across - 0.7));
		float pulse = pow(fract(UV.y * 0.5 - TIME * 1.2 + floor(UV.x * 3.0) * 0.33), 6.0);
		glow = vec3(0.62, 0.45, 1.0) * (rib * 0.8 + pulse * smoothstep(0.6, 0.0, across) * 2.0);
		edge = 1.0 - smoothstep(0.88, 1.0, across);
		rough = 0.15;
	}
	int fog = channel(tile_at(axial_round(world_to_axial(wpos.xz))).g);
	if (fog == 1) { c = sepia_drawing(c, wpos.xz); glow = vec3(0.0); }
	ALBEDO = c;
	EMISSION = glow;
	ALPHA = fog == 2 ? 0.0 : edge;
	ROUGHNESS = rough;
}
