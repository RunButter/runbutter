-- Create contact_messages table
CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_read BOOLEAN DEFAULT false
);

-- Enable RLS
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- Allow public to insert contact messages
CREATE POLICY "Allow public insert contact messages" ON contact_messages
    FOR INSERT WITH CHECK (true);

-- Allow company admins to view messages (optional, or just for DB owner)
CREATE POLICY "Allow authenticated view contact messages" ON contact_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            AND role IN ('owner', 'admin')
        )
    );
