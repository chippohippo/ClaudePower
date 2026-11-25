// Shared hex-map maths for the terrain and water shaders.
// The map is described by a data texture with one texel per tile (odd-r offset layout, like the simulation):
//   R = terrain layer (0 grassland, 1 plains, 2 desert, 3 tundra, 4 snow, 5 rock, 6 cliff, 7 beach)
//   G = fog: 0 visible · 1 remembered · 2 unexplored
//   B = water: 0 land · 1 coast · 2 ocean · 3 lake / Great River channel
//   A = feature tint: 0 none · 1 floodplains · 2 marsh · 3 bloom · 4 flooded · 5 pillaged · 6 oasis · 7 engineered · 8 substrate
//       · 9 farm fields · 10 plantation rows · 11 pasture paddocks · 12 wild grain · 13 Inca terraces
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

float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// The world's extent in world units (the paper is folded into 4 x 3 panels across it).
vec2 world_extent() { return vec2(map_size.x * SQRT3, map_size.y * 1.5); }

// Old paper: fibre, grain, tea stains, foxing spots and the creases where the chart was folded.
vec3 paper(vec2 wp) {
	float fibre = texture(paper_noise, wp * 0.9).b;
	float grain = texture(paper_noise, wp * 3.7 + 0.21).g;
	float stain = smoothstep(0.42, 0.78, texture(paper_noise, wp * 0.05 + 0.5).r);
	float blotch = smoothstep(0.55, 0.85, texture(paper_noise, wp * 0.13 + 0.17).r);
	vec3 c = paper_color * (0.80 + 0.26 * fibre + 0.08 * grain);
	c = mix(c, c * vec3(0.72, 0.58, 0.40), stain * 0.6);          // tea stains of an old chart
	c = mix(c, c * vec3(0.86, 0.78, 0.66), blotch * 0.35);
	float fox = smoothstep(0.86, 0.93, texture(paper_noise, wp * 0.61 + 0.73).g) * smoothstep(0.5, 0.8, texture(paper_noise, wp * 0.08).b);
	c = mix(c, c * vec3(0.66, 0.46, 0.28), fox * 0.55);           // foxing: little rust-brown spots
	vec2 ext = world_extent();
	vec2 panel = vec2(ext.x / 4.0, ext.y / 3.0);
	vec2 off = wp + (texture(paper_noise, wp * 0.02).rg - 0.5) * 0.8;
	vec2 fold = abs(mod(off + panel * 0.5, panel) - panel * 0.5);  // distance to the nearest crease
	float crease = max(1.0 - smoothstep(0.0, 0.35, fold.x), 1.0 - smoothstep(0.0, 0.35, fold.y));
	float side = sign(mod(off.x, panel.x) - panel.x * 0.5) * 0.5 + 0.5;
	c *= 1.0 - crease * (0.14 + 0.06 * side);                    // a worn crease, darker on one side
	c = mix(c, c * 1.08, (1.0 - smoothstep(0.35, 0.8, min(fold.x, fold.y))) * 0.4 * (1.0 - side));
	return c;
}

// A portolan chart of the unknown: rhumb lines radiating from wind-rose hubs (the eight winds in ink, half-winds in green,
// quarter-winds in red), with an inked compass rose at some hubs.
vec3 chart(vec2 wp) {
	vec3 c = paper(wp);
	const float SPACING = 24.0;
	vec2 cell = floor(wp / SPACING);
	float lines = 0.0;
	vec3 line_col = ink_color;
	for (int i = 0; i < 9; i++) {
		vec2 k = cell + vec2(float(i % 3), float(i / 3)) - 1.0;
		vec2 hub = (k + 0.5 + (vec2(hash12(k), hash12(k + 7.1)) - 0.5) * 0.5) * SPACING;
		vec2 v = wp - hub;
		float d = length(v);
		if (d > SPACING * 0.75) continue;
		float a = atan(v.y, v.x);
		float step_a = 6.2831853 / 32.0;
		float n = round(a / step_a);
		float perp = d * abs(sin(a - n * step_a));
		float w = 0.035 + d * 0.0006;
		float on = (1.0 - smoothstep(w * 0.5, w, perp)) * (1.0 - smoothstep(SPACING * 0.5, SPACING * 0.75, d)) * smoothstep(4.4, 5.0, d);
		int wind = int(mod(n, 4.0));
		vec3 col = (wind == 0) ? ink_color : ((wind == 2) ? vec3(0.18, 0.36, 0.22) : vec3(0.55, 0.16, 0.12));
		float strength = (wind == 0) ? 0.55 : ((wind == 2) ? 0.45 : 0.35);
		if (on * strength > lines) { lines = on * strength; line_col = col; }

		// the compass rose at the hub
		if (hash12(k + 3.3) > 0.6 && d < 5.0) {
			float R = 4.0;
			float star8 = mix(0.42, R, pow(abs(cos(a * 4.0)), 18.0));
			float star16 = mix(0.42, R * 0.62, pow(abs(cos(a * 4.0 + 0.3927)), 18.0));
			float shade = step(0.0, sin(a * 8.0));          // each point: one half inked, one half left as paper
			vec3 rose = c;
			if (d < star16) rose = mix(c, vec3(0.55, 0.16, 0.12), 0.55 + 0.3 * shade);
			if (d < star8) rose = mix(c, ink_color, 0.25 + 0.6 * shade);
			float outline = max(1.0 - smoothstep(0.0, 0.05, abs(d - star8)), 1.0 - smoothstep(0.0, 0.04, abs(d - star16)));
			float rings = max(1.0 - smoothstep(0.0, 0.04, abs(d - R * 1.04)), 1.0 - smoothstep(0.0, 0.03, abs(d - R * 1.14)));
			float ticks = (1.0 - smoothstep(0.0, 0.04, abs(d - R * 1.09) - 0.05)) * step(0.7, abs(cos(a * 16.0)));
			rose = mix(rose, ink_color, max(max(outline * 0.8, rings * 0.7), ticks * 0.6));
			rose = mix(rose, vec3(0.62, 0.45, 0.12), (1.0 - smoothstep(0.18, 0.3, d)) * 0.9);   // a gilt centre
			return rose;
		}
	}
	return mix(c, line_col, lines);
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

// Pen hatching for the drawing: diagonal strokes where the ground is steep or dark, cross-hatched where it is steeper still.
vec3 hatch(vec3 c, vec2 wp, float shade) {
	float wob = texture(paper_noise, wp * 0.6).r * 0.6;
	float s1 = 1.0 - smoothstep(0.08, 0.2, abs(fract((wp.x + wp.y) * 3.2 + wob) - 0.5));
	float s2 = 1.0 - smoothstep(0.08, 0.2, abs(fract((wp.x - wp.y) * 3.2 + wob) - 0.5));
	float ink = s1 * smoothstep(0.15, 0.4, shade) + s2 * smoothstep(0.45, 0.75, shade);
	return mix(c, ink_color, clamp(ink, 0.0, 1.0) * 0.45);
}

// ---- revealing the world ------------------------------------------------------------------------
// change_data holds, per tile, the clock time its fog last changed (R) and the fog it had before (G, as a number 0..2).
// For a moment after the change the old look burns away into the new along a ragged, glowing ink edge.

uniform sampler2D change_data : filter_nearest;
uniform float reveal_clock = 0.0;
const float REVEAL_SECONDS = 1.4;

vec2 change_at(vec2 axial) {
	int q = int(axial.x);
	int r = int(axial.y);
	int col = q + (r - (r & 1)) / 2;
	int w = int(map_size.x);
	int h = int(map_size.y);
	if (r < 0 || r >= h) return vec2(-100.0, 2.0);
	if (wrap_x) col = ((col % w) + w) % w;
	else if (col < 0 || col >= w) return vec2(-100.0, 2.0);
	return texelFetch(change_data, ivec2(col, r), 0).rg;
}

// 0 = still the old look, 1 = the new; edge > 0 near the burning front.
float reveal_progress(vec2 axial, vec2 wp, out int previous, out float edge) {
	vec2 ch = change_at(axial);
	previous = int(round(ch.g));
	edge = 0.0;
	float t = (reveal_clock - ch.r) / REVEAL_SECONDS;
	if (t >= 1.0 || t < 0.0) return 1.0;
	// a hole burns from the middle of the tile outward, its edge ragged with the paper's fibres
	float from_centre = length(wp - axial_to_world(axial));
	float n = from_centre * 0.62 + texture(paper_noise, wp * 0.35).r * 0.3 + texture(paper_noise, wp * 1.7).g * 0.12;
	float front = t * 1.3 - 0.05;
	edge = 1.0 - smoothstep(0.0, 0.05, abs(n - front));
	return smoothstep(front - 0.02, front + 0.02, n) < 0.5 ? 1.0 : 0.0;
}
