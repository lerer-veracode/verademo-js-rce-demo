# Intentionally insecure demo image.
# Note: no non-root USER is defined, so the app runs as root (uid 0) inside the
# container. This is one of the issues the demo highlights after the YAML RCE.
FROM node:18

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Seed the SQLite database at build time.
RUN npm run init-db

# A "sensitive" env var, to demonstrate what an RCE can exfiltrate.
ENV APP_SECRET="demo-super-secret-value-change-me"
ENV DB_PASSWORD="demo-db-password"

EXPOSE 3000

# No USER directive on purpose -> container runs as root.
CMD ["node", "server.js"]
