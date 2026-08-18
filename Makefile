SHELL := /bin/sh
export CI := true

# Topological order: every workspace dependency is published before its consumers.
RELEASE_PACKAGES := lifecycle reactive middleware-pipeline event-subscriber serialize resource storage-contract plugin-host web-rpc logger storage-web
GITHUB_PACKAGES_REGISTRY := https://npm.pkg.github.com

.PHONY: middleware-pipeline event-subscriber plugin-host logger web-rpc storage-web reactive resource lifecycle serialize storage-contract \
	middleware-pipeline-check middleware-pipeline-patch middleware-pipeline-publish \
	event-subscriber-check event-subscriber-patch event-subscriber-publish \
	plugin-host-check logger-check web-rpc-check storage-web-check \
	plugin-host-patch logger-patch web-rpc-patch storage-web-patch \
	plugin-host-publish logger-publish web-rpc-publish storage-web-publish \
	reactive-check reactive-patch reactive-publish \
	resource-check resource-patch resource-publish \
	lifecycle-check lifecycle-patch lifecycle-publish \
	serialize-check serialize-patch serialize-publish \
	storage-contract-check storage-contract-patch storage-contract-publish \
	check-package release-check auth-check patch publish ship

ship:
	@set -eu; \
	for package in $(RELEASE_PACKAGES); do \
		echo "==> shipping $$package"; \
		$(MAKE) "$$package"; \
	done; \
	echo "==> all release packages shipped"

check-package:
	@if [ -z "$(PACKAGE)" ]; then \
		echo "Internal error: PACKAGE is not set" >&2; \
		exit 2; \
	fi; \
	case "$(PACKAGE)" in \
		middleware-pipeline|event-subscriber|plugin-host|logger|web-rpc|storage-web|reactive|resource|lifecycle|serialize|storage-contract) ;; \
		*) echo "Unsupported PACKAGE=$(PACKAGE)" >&2; exit 2 ;; \
	esac

release-check: check-package
	@set -eu; \
	package="$(PACKAGE)"; \
	echo "==> checking @migaia/$$package"; \
	pnpm @$$package fmt; \
	pnpm @$$package lint; \
	pnpm @$$package typecheck; \
	if [ "$$package" = "middleware-pipeline" ] || [ "$$package" = "event-subscriber" ] || [ "$$package" = "plugin-host" ] || [ "$$package" = "logger" ] || [ "$$package" = "reactive" ] || [ "$$package" = "resource" ] || [ "$$package" = "lifecycle" ] || [ "$$package" = "serialize" ] || [ "$$package" = "storage-contract" ]; then \
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
	@set -eu; \
	echo "==> patching @migaia/$(PACKAGE)"; \
	pnpm @$(PACKAGE) release:patch; \
	version=$$(node -p "require('./packages/$(PACKAGE)/package.json').version"); \
	git add "packages/$(PACKAGE)/package.json"; \
	git commit -m "chore(release): $(PACKAGE) v$$version"

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
	branch=$$(git rev-parse --abbrev-ref HEAD); \
	echo "==> pushing $$branch"; \
	git push origin "HEAD:$$branch"; \
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

middleware-pipeline: PACKAGE := middleware-pipeline
middleware-pipeline: release-check auth-check patch publish

event-subscriber: PACKAGE := event-subscriber
event-subscriber: release-check auth-check patch publish

reactive: PACKAGE := reactive
reactive: release-check auth-check patch publish

resource: PACKAGE := resource
resource: release-check auth-check patch publish

lifecycle: PACKAGE := lifecycle
lifecycle: release-check auth-check patch publish

serialize: PACKAGE := serialize
serialize: release-check auth-check patch publish

storage-contract: PACKAGE := storage-contract
storage-contract: release-check auth-check patch publish

event-subscriber-check: PACKAGE := event-subscriber
event-subscriber-check: release-check

event-subscriber-patch: PACKAGE := event-subscriber
event-subscriber-patch: patch

event-subscriber-publish: PACKAGE := event-subscriber
event-subscriber-publish: publish

reactive-check: PACKAGE := reactive
reactive-check: release-check

reactive-patch: PACKAGE := reactive
reactive-patch: patch

reactive-publish: PACKAGE := reactive
reactive-publish: publish

resource-check: PACKAGE := resource
resource-check: release-check

resource-patch: PACKAGE := resource
resource-patch: patch

resource-publish: PACKAGE := resource
resource-publish: publish

lifecycle-check: PACKAGE := lifecycle
lifecycle-check: release-check

lifecycle-patch: PACKAGE := lifecycle
lifecycle-patch: patch

lifecycle-publish: PACKAGE := lifecycle
lifecycle-publish: publish

serialize-check: PACKAGE := serialize
serialize-check: release-check

serialize-patch: PACKAGE := serialize
serialize-patch: patch

serialize-publish: PACKAGE := serialize
serialize-publish: publish

storage-contract-check: PACKAGE := storage-contract
storage-contract-check: release-check

storage-contract-patch: PACKAGE := storage-contract
storage-contract-patch: patch

storage-contract-publish: PACKAGE := storage-contract
storage-contract-publish: publish

plugin-host-check: PACKAGE := plugin-host
plugin-host-check: release-check

logger-check: PACKAGE := logger
logger-check: release-check

web-rpc-check: PACKAGE := web-rpc
web-rpc-check: release-check

storage-web-check: PACKAGE := storage-web
storage-web-check: release-check

middleware-pipeline-check: PACKAGE := middleware-pipeline
middleware-pipeline-check: release-check

plugin-host-patch: PACKAGE := plugin-host
plugin-host-patch: patch

logger-patch: PACKAGE := logger
logger-patch: patch

web-rpc-patch: PACKAGE := web-rpc
web-rpc-patch: patch

storage-web-patch: PACKAGE := storage-web
storage-web-patch: patch

middleware-pipeline-patch: PACKAGE := middleware-pipeline
middleware-pipeline-patch: patch

plugin-host-publish: PACKAGE := plugin-host
plugin-host-publish: publish

logger-publish: PACKAGE := logger
logger-publish: publish

web-rpc-publish: PACKAGE := web-rpc
web-rpc-publish: publish

storage-web-publish: PACKAGE := storage-web
storage-web-publish: publish

middleware-pipeline-publish: PACKAGE := middleware-pipeline
middleware-pipeline-publish: publish
