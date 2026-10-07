"""Estimate how well proposed lighthouses narrow a Pirate treasure search.

Input JSON: {"treasure": {"lat": ..., "lng": ...},
             "lighthouses": [{"name": ..., "lat": ..., "lng": ...}, ...]}

Areas are sampled on a local metre grid. They are placement estimates, not
promises about phone GPS accuracy or the actual game HMAC secret.
"""

import argparse
import hashlib
import hmac
import itertools
import json
import math
from pathlib import Path

EARTH_RADIUS_M = 6_371_000
HALF_WIDTHS = (90, 45, 25, 12, 5)


def point(value):
    if not isinstance(value, dict) or not isinstance(value.get("lat"), (int, float)) or not isinstance(value.get("lng"), (int, float)):
        raise ValueError("each point needs numeric lat and lng")
    lat, lng = value["lat"], value["lng"]
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise ValueError("point coordinates must be finite WGS84 degrees")
    return lat, lng


def local_xy(lat, lng, origin_lat, origin_lng):
    longitude_delta = (lng - origin_lng + 180) % 360 - 180
    return (
        EARTH_RADIUS_M * math.radians(longitude_delta) * math.cos(math.radians(origin_lat)),
        EARTH_RADIUS_M * math.radians(lat - origin_lat),
    )


def bearing(dx, dy):
    return math.degrees(math.atan2(dx, dy)) % 360


def angle_difference(a, b):
    return (a - b + 180) % 360 - 180


def crossing_angle(a, b):
    return abs(angle_difference(bearing(-a[0], -a[1]), bearing(-b[0], -b[1])))


def simulated_centre(true_bearing, half_width, secret, name, level):
    digest = hmac.new(secret.encode(), f"{name}:{level}".encode(), hashlib.sha256).digest()
    u = int.from_bytes(digest[:4], "big") / 2**32
    return (round(true_bearing + (2 * u - 1) * 0.8 * half_width) + 360) % 360


def estimate(data, *, cell_m=20, radius_m=2000, secret="placement-example"):
    if cell_m <= 0 or radius_m <= 0 or cell_m > radius_m:
        raise ValueError("cell and radius must be positive, with cell <= radius")
    treasure_lat, treasure_lng = point(data["treasure"])
    lights = data["lighthouses"]
    if not isinstance(lights, list) or len(lights) < 2 or len(lights) > 20:
        raise ValueError("provide 2 to 20 lighthouses")
    if any(not isinstance(item, dict) for item in lights):
        raise ValueError("each lighthouse must be an object")
    names = [item.get("name") for item in lights]
    if any(not isinstance(name, str) or not name.strip() for name in names) or len(set(names)) != len(names):
        raise ValueError("lighthouse names must be distinct nonempty strings")
    positions = [local_xy(*point(item), treasure_lat, treasure_lng) for item in lights]
    distances = [math.hypot(*p) for p in positions]
    if any(d < 1 for d in distances):
        raise ValueError("a lighthouse coincides with the treasure")
    limit = math.ceil(radius_m / cell_m)
    cells = [(x * cell_m, y * cell_m) for x in range(-limit, limit + 1) for y in range(-limit, limit + 1)
             if x * x + y * y <= (radius_m / cell_m) ** 2]
    pairs = list(itertools.combinations(range(len(lights)), 2))
    geometry = [{"pair": [names[i], names[j]], "crossing_deg": round(crossing_angle(positions[i], positions[j]), 1),
                 "warning": crossing_angle(positions[i], positions[j]) < 30 or crossing_angle(positions[i], positions[j]) > 150}
                for i, j in pairs]
    levels = []
    for level, half_width in enumerate(HALF_WIDTHS, 1):
        centres = [simulated_centre(bearing(-x, -y), half_width, secret, names[i], level)
                   for i, (x, y) in enumerate(positions)]
        masks = []
        for (lx, ly), centre in zip(positions, centres):
            masks.append({index for index, (x, y) in enumerate(cells)
                          if abs(angle_difference(bearing(x - lx, y - ly), centre)) <= half_width})
        areas = [{"pair": [names[i], names[j]], "area_km2": round(len(masks[i] & masks[j]) * cell_m**2 / 1_000_000, 3)}
                 for i, j in pairs]
        triples = [{"lighthouses": [names[i], names[j], names[k]],
                    "area_km2": round(len(masks[i] & masks[j] & masks[k]) * cell_m**2 / 1_000_000, 3)}
                   for i, j, k in itertools.combinations(range(len(lights)), 3)]
        levels.append({"shards": level, "half_width_deg": half_width, "pair_areas": areas,
                       "best_pair": min(areas, key=lambda row: row["area_km2"]),
                       "best_triple": min(triples, key=lambda row: row["area_km2"]) if triples else None})
    return {"method": "local grid, simulated HMAC offsets; estimates clipped to search circle",
            "cell_m": cell_m, "search_radius_m": radius_m,
            "lighthouses": [{"name": name, "distance_m": round(distance),
                             "warning": distance < 200 or distance > 1500}
                            for name, distance in zip(names, distances)],
            "crossings": geometry, "levels": levels}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON with treasure and lighthouses")
    parser.add_argument("--cell-m", type=int, default=20)
    parser.add_argument("--radius-m", type=int, default=2000)
    parser.add_argument("--seed", default="placement-example", help="simulation seed, not a production secret")
    args = parser.parse_args()
    try:
        result = estimate(json.loads(args.input.read_text(encoding="utf-8")), cell_m=args.cell_m,
                          radius_m=args.radius_m, secret=args.seed)
    except (ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
