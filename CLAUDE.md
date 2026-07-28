# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains the code for NutriAI, a calorie tracking application with three main components:
1.  A backend server built with Express.js, providing a RESTful API and an MCP server.
2.  A web-based Progressive Web App (PWA) built with Vue.js.
3.  A native mobile app for iOS and Android built with Expo/React Native.

The backend uses a SQLite database for persistence and can be deployed in various environments, including directly on a Node.js server, in a Docker container, or on platforms like Railway.

## Repository Structure

The repository is a monorepo with the following top-level directories:

*   `src/`: The Express.js backend, API, and MCP server.
*   `web/`: The Vue 3 PWA, which is built into the `public/app/` directory and served by the backend.
*   `mobile/`: The Expo/React Native app for iOS and Android. This is a separate project with its own dependencies and build process.
*   `public/`: Contains the built PWA and other static assets.
*   `migrations/`: Contains the database migration scripts.
*   `deploy/`: Contains deployment-related scripts and documentation for different platforms.

## Common Commands

### Backend

*   `pnpm dev`: Starts the backend server in development mode with a file watcher.
*   `pnpm start`: Starts the backend server in production mode.
*   `pnpm test`: Runs the backend test suite.
*   `pnpm test:watch`: Runs the backend tests in watch mode.
*   `pnpm lint:fix`: Lints and fixes the backend code.
*   `pnpm type-check`: Performs a static type check of the backend code.
*   `pnpm db:migrate`: Applies the latest database migrations.

### Frontend (Web)

*   `pnpm web:dev`: Starts the Vite dev server for the Vue.js PWA.
*   `pnpm web:build`: Builds the PWA for production.
*   `pnpm web:type-check`: Performs a static type check of the PWA code.

### Mobile App

*   `cd mobile && npm install`: Installs the dependencies for the mobile app.
*   `cd mobile && npx expo start`: Starts the Expo development server for the mobile app.
*   `cd mobile && npx expo run:ios`: Builds and runs the mobile app on an iOS simulator or device.
*   `cd mobile && npx expo run:android`: Builds and runs the mobile app on an Android emulator or device.

## Architecture

### Backend Architecture

The backend is a Node.js application built with Express.js and TypeScript. It follows a layered architecture:

*   **`src/index.ts`**: The main entry point for the application. It initializes the Express server, sets up middleware, and registers the routes.
*   **`src/http/`**: Contains the API routes. `src/http/api.js` registers the main API routes.
*   **`src/auth/`**: Handles authentication, including a custom OAuth 2.0 implementation.
*   **`src/mcp/`**: Implements the Model Context Protocol (MCP) server and its tools.
*   **`src/services/`**: Contains the business logic of the application.
*   **`src/repositories/`**: The data access layer, responsible for interacting with the database.
*   **`src/db/`**: Manages the SQLite database connection, schema, and migrations.

### Frontend Architecture

*   **`web/`**: A Vue.js 3 Progressive Web App (PWA). It is a single-page application that communicates with the backend via the RESTful API.
*   **`mobile/`**: An Expo/React Native application for iOS and Android. It provides a native user experience and also communicates with the backend API.

## Environment Variables

The application is configured using environment variables. The most important ones are:

*   `PORT`: The port on which the server will run (default: `8787`).
*   `DATABASE_PATH`: The path to the SQLite database file (default: `./data/calorie-tracker.db`).
*   `ADMIN_API_KEY`: The API key for administrative tasks.
*   `ADMIN_EMAIL`: The email for the default admin user.
*   `ADMIN_PASSWORD`: The password for the default admin user.
*   `SESSION_TTL_HOURS`: The time-to-live for user sessions in hours.
*   `BASE_URL`: The public URL of the server.

Refer to the `README.md` for a complete list of environment variables.

## Deployment

The application can be deployed in several ways:

*   **Directly on a Node.js server**: The `pnpm start` command can be used to run the application in a production environment.
*   **Docker**: A `Dockerfile` is provided to build a Docker image of the application.
*   **Railway**: The application is configured for easy deployment on the Railway platform.

Refer to the `README.md` and the `deploy/` directory for detailed deployment instructions.
