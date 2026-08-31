SHELL := /bin/sh
export CI := true
# Release validation must report missing dependencies instead of allowing pnpm
# to repair the workspace implicitly or access the registry during a dry-run.
export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN := false

# Publish foundations before every consumer. scripts/release-plan.mjs verifies
# that this remains a closed, dependency-topological release set.
RELEASE_PACKAGES := utils event-subscriber lifecycle reactive middleware-pipeline serialize resource storage-contract capability plugin-host tray web-rpc logger storage-web
RELEASE_BRANCH ?= main
GITHUB_PACKAGES_REGISTRY := https://npm.pkg.github.com

CHECK_TARGETS := $(addsuffix -check,$(RELEASE_PACKAGES))
PATCH_TARGETS := $(addsuffix -patch,$(RELEASE_PACKAGES))
PUBLISH_TARGETS := $(addsuffix -publish,$(RELEASE_PACKAGES))

.PHONY: $(RELEASE_PACKAGES) $(CHECK_TARGETS) $(PATCH_TARGETS) $(PUBLISH_TARGETS) \
	ship ship-dry-run ship-preflight ship-check ship-pack-check ship-release release-plan-check \
	ship-ci ship-cd \
	dependencies-check check-package release-check git-release-check git-publish-check auth-check patch publish

# Ship has one visible direction: prove the whole plan, prove every package,
# then enter the irreversible release loop. No package is versioned before all
# package checks have passed.
ship:
	@$(MAKE) ship-preflight
	@$(MAKE) ship-ci
	@$(MAKE) ship-pack-check
	@$(MAKE) ship-cd
	@echo "==> all release packages shipped"

# Executes every local release gate and previews each package artifact without
# changing versions, Git state, registry state, or remote refs.
ship-dry-run:
	@$(MAKE) release-plan-check
	@$(MAKE) dependencies-check
	@$(MAKE) ship-ci
	@$(MAKE) ship-pack-check
	@echo "==> ship dry-run passed; no release mutations performed"

ship-preflight:
	@$(MAKE) release-plan-check
	@$(MAKE) dependencies-check
	@$(MAKE) git-release-check
	@$(MAKE) auth-check

dependencies-check:
	@test -x node_modules/.bin/oxfmt || { echo "Missing workspace dependencies; run pnpm install --frozen-lockfile" >&2; exit 1; }
	@test -x node_modules/.bin/oxlint || { echo "Missing workspace dependencies; run pnpm install --frozen-lockfile" >&2; exit 1; }
	@test -x node_modules/.bin/tsc || { echo "Missing workspace dependencies; run pnpm install --frozen-lockfile" >&2; exit 1; }
	@test -x node_modules/.bin/vitest || { echo "Missing workspace dependencies; run pnpm install --frozen-lockfile" >&2; exit 1; }

ship-ci:
	@set -eu; \
	for package in $(RELEASE_PACKAGES); do \
		echo "==> CI validating $$package"; \
		$(MAKE) "$$package-check"; \
	done

# Backward-compatible name for callers that used the pre-phase terminology.
ship-check:
	@$(MAKE) ship-ci

ship-pack-check:
	@set -eu; \
	for package in $(RELEASE_PACKAGES); do \
		echo "==> previewing @migaia/$$package artifact"; \
		pnpm --filter "./packages/$$package" pack --dry-run --json >/dev/null; \
	done

ship-cd:
	@set -eu; \
	patched_packages=$$(node scripts/release-progress.mjs $(RELEASE_PACKAGES)); \
	for package in $(RELEASE_PACKAGES); do \
		echo "==> CD releasing $$package"; \
		case " $$patched_packages " in \
			*" $$package "*) echo "==> resuming already patched $$package" ;; \
			*) $(MAKE) "$$package-patch" ;; \
		esac; \
		$(MAKE) "$$package-publish"; \
	done

# Backward-compatible name for callers that used the pre-phase terminology.
ship-release:
	@$(MAKE) ship-cd

release-plan-check:
	@node scripts/release-plan.mjs $(RELEASE_PACKAGES)

check-package:
	@if [ -z "$(PACKAGE)" ]; then \
		echo "Internal error: PACKAGE is not set" >&2; \
		exit 2; \
	fi; \
	case " $(RELEASE_PACKAGES) " in \
		*" $(PACKAGE) "*) ;; \
		*) echo "Unsupported PACKAGE=$(PACKAGE)" >&2; exit 2 ;; \
	esac

# Mandatory gates are explicit. Formatting is checked without rewriting source.
# Optional typecheck, packed, and browser gates are discovered from the package
# manifest so adding one cannot be overlooked.
release-check: check-package
	@set -eu; \
	package="$(PACKAGE)"; \
	directory="./packages/$$package"; \
	manifest="packages/$$package/package.json"; \
	echo "==> checking @migaia/$$package"; \
	format_paths=$$(node -e 'const p=require("./"+process.argv[1]); const command=p.scripts?.fmt??""; if (!command.startsWith("oxfmt ")) process.exit(2); console.log(command.slice(6))' "$$manifest"); \
	(cd "$$directory" && ../../node_modules/.bin/oxfmt --check $$format_paths); \
	pnpm --filter "$$directory" run lint; \
	pnpm --filter "$$directory" run typecheck; \
	optional_typechecks=$$(node -e 'const p=require("./"+process.argv[1]); console.log(Object.keys(p.scripts||{}).filter((name)=>name.startsWith("typecheck:")).sort().join(" "))' "$$manifest"); \
	for gate in $$optional_typechecks; do pnpm --filter "$$directory" run "$$gate"; done; \
	pnpm --filter "$$directory" run test; \
	for gate in test:packed test:e2e; do \
		if node -e 'const p=require("./"+process.argv[1]); process.exit(p.scripts?.[process.argv[2]] ? 0 : 1)' "$$manifest" "$$gate"; then \
			pnpm --filter "$$directory" run "$$gate"; \
		fi; \
	done; \
	pnpm --filter "$$directory" run build

# A full ship starts only from a clean, synchronized release branch. This is
# intentionally stricter than package-publish, which runs after a local patch
# commit and therefore expects HEAD to be ahead of its upstream.
git-release-check: git-publish-check
	@set -eu; \
	git rev-parse --verify '@{upstream}' >/dev/null 2>&1 || { echo "Release branch has no upstream" >&2; exit 1; }; \
	git fetch --quiet origin "$(RELEASE_BRANCH)"; \
	set -- $$(git rev-list --left-right --count '@{upstream}...HEAD'); \
	if [ "$$1" -ne 0 ] || [ "$$2" -ne 0 ]; then \
		echo "Release branch must match its upstream before ship (behind=$$1 ahead=$$2)" >&2; \
		exit 1; \
	fi

git-publish-check:
	@set -eu; \
	branch=$$(git symbolic-ref --quiet --short HEAD) || { echo "Detached HEAD cannot publish" >&2; exit 1; }; \
	if [ "$$branch" != "$(RELEASE_BRANCH)" ]; then \
		echo "Release requires $(RELEASE_BRANCH), found $$branch" >&2; \
		exit 1; \
	fi; \
	if [ -n "$$(git status --porcelain)" ]; then \
		echo "Release requires a clean worktree" >&2; \
		exit 1; \
	fi

auth-check:
	@set -eu; \
	if ! pnpm whoami --registry=$(GITHUB_PACKAGES_REGISTRY) >/dev/null 2>&1; then \
		echo "GitHub Packages authentication failed or is unavailable for $(GITHUB_PACKAGES_REGISTRY)" >&2; \
		exit 1; \
	fi

patch: check-package git-publish-check
	@set -eu; \
	package="$(PACKAGE)"; \
	echo "==> patching @migaia/$$package"; \
	pnpm --filter "./packages/$$package" run release:patch; \
	version=$$(node -p "require('./packages/$$package/package.json').version"); \
	git add "packages/$$package/package.json"; \
	git commit -m "chore(release): $$package v$$version"

# Push the version commit before publishing so registry state never exists
# without a corresponding remote source revision. The temporary private-field
# removal is always restored, including interrupts and publish failures.
publish: check-package git-publish-check auth-check
	@set -eu; \
	package="$(PACKAGE)"; \
	version=$$(node -p "require('./packages/$$package/package.json').version"); \
	tag="$$package-v$$version"; \
	release_subject="chore(release): $$package v$$version"; \
	release_commit=$$(git log --fixed-strings --grep="$$release_subject" -n 1 --format=%H); \
	[ -n "$$release_commit" ] || { echo "Missing release commit: $$release_subject" >&2; exit 1; }; \
	[ "$$(git show -s --format=%s "$$release_commit")" = "$$release_subject" ] || { echo "Ambiguous release commit: $$release_subject" >&2; exit 1; }; \
	branch=$$(git symbolic-ref --quiet --short HEAD); \
	echo "==> pushing $$branch before registry mutation"; \
	git push origin "HEAD:$$branch"; \
	local_tag_commit=$$(git rev-parse --verify "$$tag^{commit}" 2>/dev/null || true); \
	remote_tag_commit=$$(git ls-remote --tags origin "refs/tags/$$tag^{}" | awk '{print $$1}'); \
	if [ -z "$$remote_tag_commit" ]; then \
		remote_tag_commit=$$(git ls-remote --tags origin "refs/tags/$$tag" | awk '{print $$1}'); \
	fi; \
	for tag_commit in $$local_tag_commit $$remote_tag_commit; do \
		[ "$$tag_commit" = "$$release_commit" ] || { echo "Release tag points at the wrong commit: $$tag" >&2; exit 1; }; \
	done; \
	published_version=$$(pnpm view "@migaia/$$package@$$version" version --registry=$(GITHUB_PACKAGES_REGISTRY) 2>/dev/null || true); \
	if [ "$$published_version" = "$$version" ]; then \
		echo "==> @migaia/$$package@$$version already published"; \
	else \
		if [ -n "$$local_tag_commit$$remote_tag_commit" ]; then \
			echo "Release tag exists but registry version is missing: $$tag" >&2; \
			exit 1; \
		fi; \
	package_json="packages/$$package/package.json"; \
	backup=$$(mktemp); \
	cp "$$package_json" "$$backup"; \
	restored=false; \
	restore() { \
		if [ "$$restored" = false ]; then \
			cp "$$backup" "$$package_json"; \
			rm -f "$$backup"; \
			restored=true; \
		fi; \
	}; \
	on_interrupt() { restore; exit 130; }; \
	on_terminate() { restore; exit 143; }; \
	trap restore EXIT; \
	trap on_interrupt INT; \
	trap on_terminate TERM; \
	sed -i.bak '/^[[:space:]]*"private"[[:space:]]*:[[:space:]]*true,[[:space:]]*$$/d' "$$package_json"; \
	rm -f "$$package_json.bak"; \
	echo "==> publishing @migaia/$$package@$$version"; \
	pnpm --filter "./packages/$$package" run release:publish; \
	restore; \
	trap - EXIT INT TERM; \
	fi; \
	if [ -z "$$local_tag_commit" ] && [ -z "$$remote_tag_commit" ]; then \
		echo "==> tagging $$tag"; \
		git tag "$$tag" "$$release_commit"; \
		git push origin "$$tag"; \
	elif [ -z "$$remote_tag_commit" ]; then \
		echo "==> resuming tag push $$tag"; \
		git push origin "$$tag"; \
	fi

# Compatibility entry points. Each concrete target delegates to the same
# package-generic owners, so the package inventory has one source of truth.
$(CHECK_TARGETS): %-check:
	@$(MAKE) release-check PACKAGE=$*

$(PATCH_TARGETS): %-patch:
	@$(MAKE) patch PACKAGE=$*

$(PUBLISH_TARGETS): %-publish:
	@$(MAKE) publish PACKAGE=$*

$(RELEASE_PACKAGES):
	@$(MAKE) $@-check
	@$(MAKE) $@-patch
	@$(MAKE) $@-publish
