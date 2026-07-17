#!/bin/bash

# runbutter Quick Start Script
# This script helps you get started quickly with local development

echo "🚀 runbutter - Quick Start Setup"
echo "===================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher. Current: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"
echo ""

# Check if .env.local exists
if [ -f ".env.local" ]; then
    echo "⚠️  .env.local already exists. Skipping creation."
else
    echo "📝 Creating .env.local file..."
    cp .env.example .env.local
    echo "✅ .env.local created from template"
    echo ""
    echo "⚠️  IMPORTANT: You need to add your credentials to .env.local"
    echo "   1. Supabase URL and anon key"
    echo "   2. Google OAuth credentials"
    echo ""
    read -p "Press Enter to continue after updating .env.local..."
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p public/uploads
mkdir -p .next
echo "✅ Directories created"
echo ""

# Setup complete
echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Next Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Set up Supabase:"
echo "   • Go to https://supabase.com"
echo "   • Create a new project"
echo "   • Run supabase-schema.sql in SQL Editor"
echo "   • Get your URL and anon key"
echo ""
echo "2. Set up Google OAuth:"
echo "   • Go to https://console.cloud.google.com"
echo "   • Enable Google Calendar API"
echo "   • Create OAuth 2.0 credentials"
echo "   • Add redirect URI: http://localhost:3000/api/auth/google/callback"
echo ""
echo "3. Update .env.local with your credentials"
echo ""
echo "4. Start development server:"
echo "   npm run dev"
echo ""
echo "5. Open http://localhost:3000"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Documentation:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "• README.md - Full setup guide"
echo "• DEPLOYMENT.md - Production deployment checklist"
echo "• supabase-schema.sql - Database setup"
echo ""
echo "Need help? Check the README.md file!"
echo ""
