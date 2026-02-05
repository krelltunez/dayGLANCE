# dayGLANCE

A beautiful, feature-rich day planner with time-blocking, task management, and calendar sync capabilities.

## Features

- 📅 **Visual Time Blocking** - Drag and drop tasks on a daily calendar view
- 📥 **Task Inbox** - Hold unscheduled tasks until you're ready to schedule them
- 🔄 **Calendar Sync** - Import events from iCal/Nextcloud/Google Calendar
- ⚠️ **Conflict Detection** - Automatic warnings for overlapping tasks
- ✅ **Task Completion** - Mark tasks as complete with visual feedback
- 🌓 **Dark Mode** - Easy on the eyes day or night
- 💾 **Data Persistence** - All data saved automatically
- 📱 **Progressive Web App** - Install on any device, works offline
- 🔒 **Self-Hosted** - Your data stays on your server

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

The app will be available at `http://localhost:6767`

### Production Deployment

1. Configure your domain in Caddy:
   ```caddy
   planner.yourdomain.com {
       reverse_proxy localhost:6767
   }
   ```

2. Deploy:
   ```bash
   docker-compose up -d --build
   ```

3. Access at `https://planner.yourdomain.com`

## Technology Stack

- **React** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **Docker** - Containerization
- **Nginx** - Web server

## PWA Features

- Works offline after first load
- Installable on mobile and desktop
- Fast loading with service worker caching
- Native app-like experience

## License

MIT
