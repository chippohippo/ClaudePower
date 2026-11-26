// Bridges where roads cross rivers (LifeLayer.BridgeMesh): plain lit geometry coloured per vertex (timber, stone, steel,
// concrete), with a little grain so planks and blocks do not look like plastic. On remembered tiles the bridge is drawn
// in the same sepia ink as the land around it; on unexplored ones it is not drawn at all.
shader_type spatial;
render_mode diffuse_burley, cull_disabled;

#include "res://shaders/hexmap.gdshaderinc"

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	int fog = channel(tile_at(axial_round(world_to_axial(wpos.xz))).g);
	if (fog == 2) discard;
	float grain = texture(paper_noise, wpos.xz * 4.0 + wpos.y * 3.0).g;
	vec3 c = COLOR.rgb * (0.85 + 0.3 * grain);
	if (fog == 1) c = sepia_drawing(c, wpos.xz);
	ALBEDO = c;
	ROUGHNESS = 0.85;
}
