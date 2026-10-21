package vercel

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// nodeVersion is the Node runtime both projects build and run on.
const nodeVersion = "24.x"

// ProjectSpec is how a Vercel project must be configured.
type ProjectSpec struct {
	Name          string
	RootDirectory string
	Framework     string
}

// The two projects the pipeline deploys.
var (
	APISpec = ProjectSpec{Name: "eduadmin-api", RootDirectory: "apps/api", Framework: "nestjs"}
	WebSpec = ProjectSpec{Name: "eduadmin-web", RootDirectory: "apps/web", Framework: "vite"}
)

// Project is a Vercel project.
type Project struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EnsureProject creates the project if it doesn't exist, then sets its root
// directory, framework and Node version, so running it again is harmless.
func (c *Client) EnsureProject(ctx context.Context, spec ProjectSpec) (Project, error) {
	var p Project
	err := c.do(ctx, "GET", "/v9/projects/"+url.PathEscape(spec.Name), nil, nil, &p)
	if IsNotFound(err) {
		p = Project{}
		err = c.do(ctx, "POST", "/v11/projects", nil, map[string]any{
			"name":          spec.Name,
			"rootDirectory": spec.RootDirectory,
			"framework":     spec.Framework,
		}, &p)
	}
	if err != nil {
		return Project{}, err
	}
	if p.ID == "" {
		return Project{}, fmt.Errorf("vercel: project %s: the response had no id", spec.Name)
	}
	if p.Name == "" {
		p.Name = spec.Name
	}

	err = c.do(ctx, "PATCH", "/v9/projects/"+url.PathEscape(p.ID), nil, map[string]any{
		"rootDirectory": spec.RootDirectory,
		"framework":     spec.Framework,
		"nodeVersion":   nodeVersion,
	}, nil)
	if err != nil {
		return Project{}, err
	}
	return p, nil
}

// ProductionOrigin returns https:// plus the project's production *.vercel.app
// domain. A project can have several (a team-scoped alias as well as its
// name); the shortest is the project's own, and the choice is stable.
func (c *Client) ProductionOrigin(ctx context.Context, projectID string) (string, error) {
	names, err := c.vercelAppDomains(ctx, projectID)
	if err != nil {
		return "", err
	}
	if len(names) == 0 {
		return "", fmt.Errorf("vercel: project %s has no production *.vercel.app domain yet", projectID)
	}
	return "https://" + names[0], nil
}

// EnsureDomain gives the project its <name>.vercel.app production domain if it
// has no *.vercel.app production domain yet. A project that has never been
// deployed has none, and the first release needs both origins before it
// deploys anything.
func (c *Client) EnsureDomain(ctx context.Context, projectID, name string) error {
	names, err := c.vercelAppDomains(ctx, projectID)
	if err != nil {
		return err
	}
	if len(names) > 0 {
		return nil
	}
	domain := name + ".vercel.app"
	err = c.do(ctx, "POST", "/v10/projects/"+url.PathEscape(projectID)+"/domains", nil,
		map[string]any{"name": domain}, nil)
	if err != nil {
		return fmt.Errorf("vercel refused to add %s to project %s, probably because another Vercel account has that name; rename the project (ProjectSpec in tools/pipeline/internal/vercel/projects.go) and run setup again: %w", domain, name, err)
	}
	return nil
}

// vercelAppDomains lists the project's production *.vercel.app domains that
// are not redirects, shortest first, then alphabetically.
func (c *Client) vercelAppDomains(ctx context.Context, projectID string) ([]string, error) {
	var resp struct {
		Domains []struct {
			Name     string `json:"name"`
			Redirect string `json:"redirect"`
		} `json:"domains"`
	}
	q := url.Values{"production": {"true"}, "limit": {"100"}}
	if err := c.do(ctx, "GET", "/v9/projects/"+url.PathEscape(projectID)+"/domains", q, nil, &resp); err != nil {
		return nil, err
	}
	var names []string
	for _, d := range resp.Domains {
		if d.Redirect == "" && strings.HasSuffix(d.Name, ".vercel.app") {
			names = append(names, d.Name)
		}
	}
	sort.Slice(names, func(i, j int) bool {
		if len(names[i]) != len(names[j]) {
			return len(names[i]) < len(names[j])
		}
		return names[i] < names[j]
	})
	return names, nil
}
