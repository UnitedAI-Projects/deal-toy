FROM ghcr.io/astral-sh/uv:0.11.26@sha256:3d868e555f8f1dbc324afa005066cd11e1053fc4743b9808ca8025283e65efa5 AS uv
FROM python:3.12-slim-bookworm@sha256:6dd8b6dab6b3adc7812bab69eca5dbdc1a5cc690ad28306d234ffb4ef8ac9753
COPY --from=uv /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglu1-mesa libxrender1 libxext6 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/cad
COPY engine/pyproject.toml engine/uv.lock ./
RUN uv sync --no-cache --link-mode copy --frozen --no-dev && useradd --uid 1000 --create-home cad
COPY engine/runner.py engine/service.py ./
USER cad
EXPOSE 8080
CMD ["/opt/cad/.venv/bin/python", "/opt/cad/service.py"]
