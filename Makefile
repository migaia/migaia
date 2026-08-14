SHELL := /bin/sh
export CI := true

RELEASE_PACKAGES := plugin-host logger web-rpc storage-web
GITHUB_PACKAGES_REGISTRY := https://npm.pkg.github.com

.PHONY: plugin-host logger web-rpc storage-web \
	plugin-host-check logger-check web-rpc-check storage-web-check \
	plugin-host-patch logger-patch web-rpc-patch storage-web-patch \
	plugin-host-publish logger-publish web-rpc-publish storage-web-publish \
	check-package release-check auth-check patch publish

check-package:
	@if [ -z "$(PACKAGE)" ]; then \
		echo "Internal error: PACKAGE is not set" >&2; \
		exit 2; \
	fi; \
	case "$(PACKAGE)" in \
		plugin-host|logger|web-rpc|storage-web) ;; \
		*) echo "Unsupported PACKAGE=$(PACKAGE)" >&2; exit 2 ;; \
	esac

release-check: check-package
	@set -eu; \
	package="$(PACKAGE)"; \
	echo "==> checking @migaia/$$package"; \
	pnpm @$$package lint; \
	pnpm @$$package typecheck; \
	if [ "$$package" = "plugin-host" ] || [ "$$package" = "logger" ]; then \
		pnpm @$$package typecheck:test; \
	fi; \
	if [ "$$package" = "logger" ]; then \
		pnpm @$$package typecheck:browser; \
	fi; \
	if [ "$$package" = "web-rpc" ]; then \
		pnpm @$$package typecheck:core; \
		pnpm @$$package typecheck:node-adapter; \
		pnpm @$$package typecheck:test; \
		pnpm @$$package typecheck:e2e; \
	fi; \
	if [ "$$package" = "storage-web" ]; then \
		pnpm @$$package typecheck:test; \
		pnpm @$$package typecheck:e2e; \
	fi; \
	pnpm @$$package test; \
	if [ "$$package" = "logger" ] || [ "$$package" = "web-rpc" ] || [ "$$package" = "storage-web" ]; then \
		pnpm @$$package test:e2e; \
	fi; \
	pnpm @$$package build

patch: check-package
	@echo "==> patching @migaia/$(PACKAGE)"; \
	pnpm @$(PACKAGE) release:patch

auth-check:
	@set -eu; \
	if ! pnpm whoami --registry=$(GITHUB_PACKAGES_REGISTRY) >/dev/null 2>&1; then \
		echo "GitHub Packages authentication failed or is unavailable for $(GITHUB_PACKAGES_REGISTRY)" >&2; \
		exit 1; \
	fi

publish: check-package auth-check
	@set -eu; \
	package="$(PACKAGE)"; \
	version=$$(node -p "require('./packages/$$package/package.json').version"); \
	tag="$$package-v$$version"; \
	if git rev-parse "$$tag" >/dev/null 2>&1; then \
		echo "Git tag already exists: $$tag" >&2; \
		exit 1; \
	fi; \
	package_json="packages/$$package/package.json"; \
	backup=$$(mktemp); \
	cp "$$package_json" "$$backup"; \
	restore() { cp "$$backup" "$$package_json"; rm -f "$$backup"; }; \
	trap restore EXIT INT TERM; \
	sed -i.bak '/^[[:space:]]*"private"[[:space:]]*:[[:space:]]*true,[[:space:]]*$$/d' "$$package_json"; \
	rm -f "$$package_json.bak"; \
	echo "==> publishing @migaia/$$package@$$version"; \
	pnpm @$$package release:publish; \
	restore; \
	trap - EXIT INT TERM; \
	echo "==> tagging $$tag"; \
	git tag "$$tag"; \
	git push origin "$$tag"

plugin-host: PACKAGE := plugin-host
plugin-host: release-check auth-check patch publish

logger: PACKAGE := logger
logger: release-check auth-check patch publish

web-rpc: PACKAGE := web-rpc
web-rpc: release-check auth-check patch publish

storage-web: PACKAGE := storage-web
storage-web: release-check auth-check patch publish

plugin-host-check: PACKAGE := plugin-host
plugin-host-check: release-check

logger-check: PACKAGE := logger
logger-check: release-check

web-rpc-check: PACKAGE := web-rpc
web-rpc-check: release-check

storage-web-check: PACKAGE := storage-web
storage-web-check: release-check

plugin-host-patch: PACKAGE := plugin-host
plugin-host-patch: patch

logger-patch: PACKAGE := logger
logger-patch: patch

web-rpc-patch: PACKAGE := web-rpc
web-rpc-patch: patch

storage-web-patch: PACKAGE := storage-web
storage-web-patch: patch

plugin-host-publish: PACKAGE := plugin-host
plugin-host-publish: publish

logger-publish: PACKAGE := logger
logger-publish: publish

web-rpc-publish: PACKAGE := web-rpc
web-rpc-publish: publish

storage-web-publish: PACKAGE := storage-web
storage-web-publish: publish
