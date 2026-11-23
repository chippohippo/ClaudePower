// UI icons are drawn as a solid colour through the icon's alpha (the node's modulate is the colour),
// so one icon set serves every yield colour, and disabled buttons simply dim.
shader_type canvas_item;

void fragment() {
	float a = texture(TEXTURE, UV).a;
	COLOR = vec4(COLOR.rgb, COLOR.a * a);
}
