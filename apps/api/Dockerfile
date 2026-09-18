# syntax=docker/dockerfile:1

# Multi-stage build producing a small, portable OCI image for Cloud Run or any
# other container host. SQLx uses rustls, so no system OpenSSL is required.

FROM rust:1.97-slim-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY apps ./apps
COPY crates ./crates
COPY content ./content

RUN cargo build --release --locked -p adaptive-learn-api

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

COPY --from=builder /app/target/release/adaptive-learn-api /usr/local/bin/adaptive-learn-api

USER appuser
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080

ENTRYPOINT ["adaptive-learn-api"]
