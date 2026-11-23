// A bird: two wing triangles whose tips flap over time (each instance offset by its custom phase), dark against the land.
shader_type spatial;
render_mode unshaded, cull_disabled;

void vertex() {
	float phase = INSTANCE_CUSTOM.x * 6.2831;
	float wing = abs(VERTEX.x);
	VERTEX.y += sin(TIME * 9.0 + phase) * wing * 0.9;
}

void fragment() {
	ALBEDO = vec3(0.12, 0.1, 0.09);
}
