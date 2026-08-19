SHELL := /bin/bash

# ----------------------
# Project config
# ----------------------

CRATE := $()
ROOT_DIR := $(shell pwd)
WASM_CRATE := $(ROOT_DIR)
WEB_DIR := $(ROOT_DIR)/../morning-watch-web

WASM_OUT := $(WEB_DIR)/src/wasm


# ----------------------
# Tools
# ----------------------

CARGO := cargo
WASM_PACK := wasm-pack
NPM := aube


# ----------------------
# Default
# ----------------------

.DEFAULT_GOAL := help


# ----------------------
# Help
# ----------------------

.PHONY: help

help:
	@echo ""
	@echo "Available commands:"
	@echo ""
	@echo "  make wasm       Build Rust wasm package"
	@echo "  make dev        Start Vite dev server"
	@echo "  make build      Build wasm + frontend"
	@echo "  make clean      Clean generated files"
	@echo ""



# ----------------------
# WASM
# ----------------------

.PHONY: wasm

wasm:
	@echo "Building Rust WASM..."

	wasm-pack build \
 		--target web \
		--release \
 		--out-dir $(WASM_OUT)

	@for file in $(WASM_OUT)/*_bg.wasm; do \
		echo "Optimizing $$file"; \
		wasm-opt $$file -Oz -o $$file.tmp; \
		mv $$file.tmp $$file; \
	done

	@echo "WASM build complete"



# ----------------------
# Frontend
# ----------------------

.PHONY: dev

dev:
	cd $(WEB_DIR) && \
	$(NPM) run dev



.PHONY: install

install:
	cd $(WEB_DIR) && \
	$(NPM) install



# ----------------------
# Build
# ----------------------

.PHONY: build

build: wasm
	cd $(WEB_DIR) && \
	$(NPM) run build



# ----------------------
# Clean
# ----------------------

.PHONY: clean

clean:
	rm -rf $(WASM_OUT)
	cd $(WASM_CRATE) && cargo clean
