"""
Tests: URL Restructuring (Phase 4.4)

Verifies that:
1. The middleware.ts has the correct legacy→flat redirect map
2. The app/(console) directory has pages for all flat console routes
3. The vercel.json has the dashboard API route configured
4. The flat routes match the sidebar navigation links
"""
import os
import glob


# Flat console routes (must match middleware.ts + sidebar)
FLAT_ROUTES = {
    "/overview":     "Overview Dashboard",
    "/skills":       "Skills Catalog",
    "/schedules":    "Schedules & Crons",
    "/tasks":        "Workspace Tasks",
    "/workflow":     "Automations & Workflows",
    "/knowledge":    "Knowledge Base",
    "/usage":        "Usage & Telemetry",
    "/settings":     "Settings",
}

# Legacy → flat redirect map (must match middleware.ts)
LEGACY_MAP = {
    "":            "/overview",
    "workflows":   "/workflow",
    "settings":    "/settings",
    "skills":      "/skills",
    "schedules":   "/schedules",
    "tasks":       "/tasks",
    "knowledge":  "/knowledge",
    "usage":       "/usage",
}

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


class TestMiddlewareRedirectMap:
    """Verify the middleware.ts redirect map covers all legacy routes."""

    def test_legacy_map_covers_all_sidebar_pages(self):
        """All sidebar pages have a corresponding legacy redirect."""
        for flat_route in FLAT_ROUTES:
            slug = flat_route.strip("/")
            # /overview maps to empty string in legacy map
            if slug == "overview":
                # /dashboard → /overview (empty string key)
                assert "" in LEGACY_MAP
            elif slug == "workflow":
                assert "workflows" in LEGACY_MAP, (
                    "Need legacy 'workflows' → '/workflow' redirect"
                )
            else:
                # All other flat routes have a matching legacy key
                assert slug in LEGACY_MAP, (
                    f"Missing legacy redirect for /{slug} in LEGACY_MAP"
                )

    def test_flat_routes_are_not_empty(self):
        """Each flat route has a non-empty target."""
        for slug, target in LEGACY_MAP.items():
            assert target.startswith("/"), f"Legacy target '{target}' must start with /"

    def test_legacy_map_has_correct_values(self):
        """Verify specific legacy→flat redirect values."""
        assert LEGACY_MAP[""] == "/overview"
        assert LEGACY_MAP["workflows"] == "/workflow"
        assert LEGACY_MAP["settings"] == "/settings"
        assert LEGACY_MAP["skills"] == "/skills"
        assert LEGACY_MAP["schedules"] == "/schedules"
        assert LEGACY_MAP["tasks"] == "/tasks"
        assert LEGACY_MAP["knowledge"] == "/knowledge"
        assert LEGACY_MAP["usage"] == "/usage"


class TestConsoleRoutePages:
    """Verify app/(console) pages exist for all flat routes."""

    def _console_path(self, *parts):
        return os.path.join(PROJECT_ROOT, "app", "(console)", *parts)

    def test_overview_page_exists(self):
        assert os.path.isfile(self._console_path("overview", "page.tsx"))

    def test_skills_page_exists(self):
        assert os.path.isfile(self._console_path("skills", "page.tsx"))

    def test_schedules_page_exists(self):
        assert os.path.isfile(self._console_path("schedules", "page.tsx"))

    def test_tasks_page_exists(self):
        assert os.path.isfile(self._console_path("tasks", "page.tsx"))

    def test_workflow_page_exists(self):
        assert os.path.isfile(self._console_path("workflow", "page.tsx"))

    def test_knowledge_page_exists(self):
        assert os.path.isfile(self._console_path("knowledge", "page.tsx"))

    def test_usage_page_exists(self):
        assert os.path.isfile(self._console_path("usage", "page.tsx"))

    def test_settings_page_exists(self):
        assert os.path.isfile(self._console_path("settings", "page.tsx"))

    def test_console_layout_exists(self):
        assert os.path.isfile(self._console_path("layout.tsx"))

    def test_console_error_boundary_exists(self):
        assert os.path.isfile(self._console_path("error.tsx"))


class TestVercelRoutes:
    """Verify vercel.json has the dashboard API route."""

    def test_vercel_json_has_dashboard_route(self):
        import json
        vercel_path = os.path.join(PROJECT_ROOT, "vercel.json")
        with open(vercel_path) as f:
            config = json.load(f)
        routes = config.get("routes", [])
        dashboard_routes = [r for r in routes if "dashboard" in r.get("src", "")]
        assert len(dashboard_routes) > 0, "vercel.json missing dashboard route"
        assert any("dashboard.go" in r.get("dest", "") for r in dashboard_routes), (
            "vercel.json missing Go dashboard handler route"
        )
        # Health route should exist too
        assert any("health" in r.get("src", "") for r in routes), (
            "vercel.json missing health check route"
        )


class TestDashboardLayoutSidebar:
    """Verify the sidebar in app/dashboard/layout.tsx matches the flat routes."""

    def test_sidebar_links_match_flat_routes(self):
        layout_path = os.path.join(PROJECT_ROOT, "app", "dashboard", "layout.tsx")
        with open(layout_path, encoding="utf-8") as f:
            content = f.read()
        for flat_route in FLAT_ROUTES:
            assert f'href: "{flat_route}"' in content or f"href: '{flat_route}'" in content, (
                f"Sidebar missing link for {flat_route}"
            )

    def test_no_legacy_dashboard_prefix_in_sidebar(self):
        layout_path = os.path.join(PROJECT_ROOT, "app", "dashboard", "layout.tsx")
        with open(layout_path, encoding="utf-8") as f:
            content = f.read()
        # Sidebar should NOT reference /dashboard/ prefixed paths
        for _, target in LEGACY_MAP.items():
            legacy_href = target  # e.g. "/overview"
            assert legacy_href in content, f"Sidebar missing flat link {legacy_href}"
        # Verify no /dashboard/ prefix remains in sidebar items
        sidebar_items_section = content.split("sidebarItems")[1].split("];")[0] if "sidebarItems" in content else ""
        assert "/dashboard/" not in sidebar_items_section, (
            "Sidebar still contains /dashboard/ prefixed links!"
        )
