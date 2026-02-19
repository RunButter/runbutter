#!/bin/bash

# TalentInsight - Automated Installation Script
# This script sets up everything you need to run the app locally

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║         🚀 TalentInsight - Automated Setup 🚀              ║"
echo "║                                                            ║"
echo "║       Multi-Tenant Recruitment Assessment SaaS            ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check Node.js
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Checking Requirements"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    echo ""
    echo "Please install Node.js 18+ from: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be 18 or higher (current: $(node -v))"
    exit 1
fi

print_success "Node.js $(node -v) detected"

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed"
    exit 1
fi

print_success "npm $(npm -v) detected"
echo ""

# Install dependencies
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Installing Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

print_info "This may take a few minutes..."
npm install --legacy-peer-deps

if [ $? -eq 0 ]; then
    print_success "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
    exit 1
fi
echo ""

# Create .env.local if it doesn't exist
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3: Environment Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f ".env.local" ]; then
    print_warning ".env.local already exists"
    echo ""
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Keeping existing .env.local"
    else
        cp .env.example .env.local
        print_success "Created new .env.local from template"
    fi
else
    cp .env.example .env.local
    print_success "Created .env.local from template"
fi

echo ""
print_warning "IMPORTANT: You need to configure .env.local with your credentials!"
echo ""
echo "Required credentials:"
echo "  1. Supabase URL and anon key"
echo "  2. Google OAuth client ID and secret"
echo ""
read -p "Press Enter to open .env.local in your default editor..."

# Try to open .env.local in editor
if command -v code &> /dev/null; then
    code .env.local
elif command -v nano &> /dev/null; then
    nano .env.local
elif command -v vim &> /dev/null; then
    vim .env.local
else
    print_info "Please manually edit .env.local with your credentials"
fi

echo ""

# Create directories
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 4: Creating Project Structure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkdir -p public/uploads
mkdir -p .next
print_success "Project directories created"
echo ""

# Setup complete
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Installation Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Set up Supabase:"
echo "   • Go to https://supabase.com"
echo "   • Create a new project"
echo "   • Run supabase-schema.sql in SQL Editor"
echo "   • Create storage buckets: 'candidate-cvs', 'company-logos'"
echo "   • Get your Project URL and anon key"
echo ""
echo "2. Set up Google OAuth:"
echo "   • Go to https://console.cloud.google.com"
echo "   • Create a project and enable Google Calendar API"
echo "   • Create OAuth 2.0 credentials"
echo "   • Add redirect URI: http://localhost:3000/api/auth/google/callback"
echo "   • Get Client ID and Secret"
echo ""
echo "3. Update .env.local with your credentials"
echo ""
echo "4. Start the development server:"
echo "   ${GREEN}npm run dev${NC}"
echo ""
echo "5. Open http://localhost:3000 in your browser"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Documentation:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "• README.md - Complete setup guide"
echo "• LAUNCH_GUIDE.md - Step-by-step deployment"
echo "• PROJECT_STRUCTURE.md - Architecture overview"
echo ""
echo "Need help? Check the documentation or create an issue on GitHub!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Do you want to start the development server now? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    print_info "Starting development server..."
    echo ""
    print_warning "Make sure you've configured .env.local first!"
    echo ""
    sleep 2
    npm run dev
else
    echo ""
    print_success "Setup complete! Run 'npm run dev' when you're ready."
    echo ""
fi
