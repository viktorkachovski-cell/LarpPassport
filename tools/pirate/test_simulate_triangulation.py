import unittest

from simulate_triangulation import angle_difference, estimate


class TriangulationTests(unittest.TestCase):
    def setUp(self):
        self.layout = {
            "treasure": {"lat": 50.0, "lng": 30.0},
            "lighthouses": [
                {"name": "North", "lat": 50.005, "lng": 30.0},
                {"name": "East", "lat": 50.0, "lng": 30.007},
                {"name": "South", "lat": 49.995, "lng": 30.0},
            ],
        }

    def test_bearing_wrap_uses_shortest_angle(self):
        self.assertEqual(angle_difference(1, 359), 2)

    def test_repeatable_nonempty_pair_intersections(self):
        result = estimate(self.layout, cell_m=50, radius_m=1000)
        self.assertEqual(result, estimate(self.layout, cell_m=50, radius_m=1000))
        self.assertEqual(len(result["levels"]), 5)
        for level in result["levels"]:
            self.assertGreater(level["best_pair"]["area_km2"], 0)
            self.assertIsNotNone(level["best_triple"])

    def test_close_lighthouse_is_flagged(self):
        self.layout["lighthouses"][0]["lat"] = 50.0005
        self.assertTrue(estimate(self.layout, cell_m=100, radius_m=1000)["lighthouses"][0]["warning"])

    def test_duplicate_names_rejected(self):
        self.layout["lighthouses"][1]["name"] = "North"
        with self.assertRaises(ValueError):
            estimate(self.layout)


if __name__ == "__main__":
    unittest.main()
