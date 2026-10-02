# Validation runner image (secondary to GitHub Actions). Node + Playwright browsers + psql. The repository is bind-mounted at /work by docker-compose.yml.
FROM mcr.microsoft.com/playwright:v1.56.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["bash", "/work/docker/validation/entrypoint.sh"]
