// Shared hex-map maths for the terrain and water shaders.
// The map is described by a data texture with one texel per tile (odd-r offset layout, like the simulation):
//   R = terrain layer (0 grassland, 1 plains, 2 desert, 3 tundra, 4 snow, 5 rock, 6 cliff, 7 beach)
//   G = fog: 0 visible · 1 remembered · 2 unexplored
//   B = water: 0 land · 1 coast · 2 ocean · 3 lake / Great River channel
//   A = feature tint: 0 none · 1 floodplains · 2 marsh · 3 bloom · 4 flooded · 5 pillaged · 6 oasis · 7 engineered · 8 substrate
//       · 9 farm fields · 10 plantation rows · 11 pasture paddocks · 12 wild grain
// Every pixel finds its tile and the neighbour across the nearest edge, so terrains blend over soft, wobbly, hand-painted
// borders instead of hard hexagons (the Civ VI look), while the tile itself stays exactly where the rules say it is.

uniform sampler2D tile_data : filter_nearest;
uniform vec2 map_size = vec2(64.0, 40.0);
uniform bool wrap_x = true;
uniform sampler2D paper_noise : filter_linear_mipmap, repeat_enable;

const float SQRT3 = 1.7320508;
const float APOTHEM = 0.8660254;

vec2 world_to_axial(vec2 p) {
	float r = p.y / 1.5;
	return vec2(p.x / SQRT3 - r * 0.5, r);
}

vec2 axial_to_world(vec2 h) {
	return vec2(SQRT3 * (h.x + h.y * 0.5), 1.5 * h.y);
}

vec2 axial_round(vec2 a) {
	vec3 c = vec3(a.x, -a.x - a.y, a.y);
	vec3 rc = round(c);
	vec3 d = abs(rc - c);
	if (d.x > d.y && d.x > d.z) rc.x = -rc.y - rc.z;
	else if (d.y > d.z) rc.y = -rc.x - rc.z;
	else rc.z = -rc.x - rc.y;
	return vec2(rc.x, rc.z);
}

// Unknown tiles (off the map) read as unexplored ocean.
vec4 tile_at(vec2 axial) {
	int q = int(axial.x);
	int r = int(axial.y);
	int col = q + (r - (r & 1)) / 2;
	int w = int(map_size.x);
	int h = int(map_size.y);
	if (r < 0 || r >= h) return vec4(0.0, 2.0 / 255.0, 2.0 / 255.0, 0.0);
	if (wrap_x) col = ((col % w) + w) % w;
	else if (col < 0 || col >= w) return vec4(0.0, 2.0 / 255.0, 2.0 / 255.0, 0.0);
	return texelFetch(tile_data, ivec2(col, r), 0);
}

int channel(float v) { return int(round(v * 255.0)); }

const vec2 DIRS[6] = vec2[6](vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));

// The tile under p, the neighbour across the closest edge, and the distance to that edge (0 on the edge).
void hex_pair(vec2 p, out vec2 a, out vec2 b, out float edge) {
	a = axial_round(world_to_axial(p));
	vec2 v = p - axial_to_world(a);
	float best = -10.0;
	b = a;
	for (int i = 0; i < 6; i++) {
		vec2 n = normalize(axial_to_world(DIRS[i]));
		float d = dot(v, n);
		if (d > best) { best = d; b = a + DIRS[i]; }
	}
	edge = APOTHEM - best;
}

// Hand-painted borders: the lookup position wanders with two octaves of noise.
vec2 wobble(vec2 p, float amount) {
	vec2 n1 = texture(paper_noise, p * 0.045).rg - 0.5;
	vec2 n2 = texture(paper_noise, p * 0.17 + 0.37).rg - 0.5;
	return p + (n1 * 0.55 + n2 * 0.22) * amount;
}

// ---- the paper map ------------------------------------------------------------------------------

uniform vec3 paper_color : source_color = vec3(0.74, 0.62, 0.43);
uniform vec3 ink_color : source_color = vec3(0.22, 0.14, 0.08);

vec3 paper(vec2 wp) {
	float fibre = texture(paper_noise, wp * 0.9).b;
	float grain = texture(paper_noise, wp * 3.7 + 0.21).g;
	float stain = smoothstep(0.42, 0.78, texture(paper_noise, wp * 0.05 + 0.5).r);
	float blotch = smoothstep(0.55, 0.85, texture(paper_noise, wp * 0.13 + 0.17).r);
	vec3 c = paper_color * (0.80 + 0.26 * fibre + 0.08 * grain);
	c = mix(c, c * vec3(0.72, 0.58, 0.40), stain * 0.6);          // tea stains of an old chart
	c = mix(c, c * vec3(0.86, 0.78, 0.66), blotch * 0.35);
	return c;
}

// Remembered land: a watercolour wash of what was seen, inked in the shadows, on the same paper.
vec3 sepia_drawing(vec3 col, vec2 wp) {
	float l = dot(col, vec3(0.3, 0.59, 0.11));
	vec3 p = paper(wp);
	vec3 wash = mix(vec3(l), col, 0.5) * 1.6;
	vec3 c = p * mix(vec3(1.0), wash, 0.38);
	c = mix(c, ink_color, (1.0 - smoothstep(0.05, 0.3, l)) * 0.22);
	return c;
}
