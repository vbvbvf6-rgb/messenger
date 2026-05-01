# P2P Messenger - Deployment & Operations Guide

## 🚀 Deployment Models

### Model 1: Free (Minimal Server)
**Best for**: Starting out, small communities, internal use

Server only handles:
- User authentication
- User registry (who's online)
- WebRTC signaling (offer/answer exchange)

**Costs**: ~$5-10/month for basic VPS (or free tier)

**Setup**:
```bash
# Deploy to Fly.io (included in existing setup)
fly deploy

# Or deploy to AWS Free Tier
# Or use your existing setup
```

### Model 2: Hybrid (With Relay)
**Best for**: Production use, ensuring connectivity

Adds:
- TURN server (relay for users behind NAT/corporate firewall)
- Message relay when peer offline

**Costs**: ~$20-50/month depending on bandwidth

**TURN Server Options**:
1. **Coturn** (open source)
   ```bash
   # Install on server
   apt-get install coturn
   ```

2. **Commercial TURN Services**:
   - Twilio: $0.04 per 1GB
   - Xirsys: $0.01 per 1GB
   - Metered: $0.007 per 1GB

### Model 3: Fully Decentralized
**Best for**: Maximum privacy and cost reduction

Adds:
- IPFS for file storage
- No central user database
- Blockchain for identity (optional)

**Costs**: Minimal (IPFS nodes run locally)

**Trade-offs**: More complex, harder UX

## 🔧 Setting Up with TURN Server

### Using Coturn (Self-hosted)

1. **Install Coturn**:
```bash
sudo apt-get update
sudo apt-get install coturn
```

2. **Configure `/etc/coturn/turnserver.conf`**:
```conf
# Basic settings
listening-port=3478
listening-ip=0.0.0.0
relay-ip=YOUR_SERVER_IP

# Authentication
user=username:password
realm=your-domain.com

# Performance
bps-capacity=0  # Unlimited
max-bps=0

# Security
no-multicast-peers
fingerprint
```

3. **Update p2p.js config**:
```javascript
this.config = {
    iceServers: [
        // STUN servers (free, for NAT detection)
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["stun:stun1.l.google.com:19302"] },
        
        // TURN server (relay, for restricted networks)
        {
            urls: ["turn:your-domain.com:3478"],
            username: "username",
            credential: "password"
        },
        // Backup TURN
        {
            urls: ["turn:your-domain.com:3479?transport=tcp"],
            username: "username",
            credential: "password"
        }
    ]
};
```

4. **Enable and start**:
```bash
sudo systemctl enable coturn
sudo systemctl start coturn
```

### Using Commercial TURN (Xirsys Example)

1. **Create account** at https://xirsys.com

2. **Get credentials** from dashboard

3. **Update p2p.js**:
```javascript
this.config = {
    iceServers: [
        // Xirsys TURN servers
        {
            urls: ["turn:your-account.xirsys.com:80?transport=tcp"],
            username: "your-username",
            credential: "your-password"
        },
        {
            urls: ["turn:your-account.xirsys.com:443?transport=tcp"],
            username: "your-username",
            credential: "your-password"
        }
    ]
};
```

## 📦 Database Optimization

### For Small Deployments (< 1000 users)
- Use SQLite (current setup)
- Local IndexedDB on clients
- No additional setup needed

### For Medium Deployments (1000-100K users)
- Migrate to PostgreSQL:

```python
# backend/database.py changes
from sqlalchemy import create_engine

# Instead of:
DATABASE_URL = "sqlite:///./test.db"

# Use:
DATABASE_URL = "postgresql://user:password@localhost/messenger"

engine = create_engine(DATABASE_URL)
```

Install PostgreSQL:
```bash
# Local development
docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres

# Production
apt-get install postgresql postgresql-contrib
```

### For Large Deployments (> 100K users)
- Use Redis for:
  - Online users cache
  - Session storage
  - Message queues

```python
# Add to backend/main.py
import redis
redis_client = redis.Redis(host='localhost', port=6379, db=0)

# Cache online users
online_users = redis_client.get("online_users")
```

## 🔐 Security Hardening

### 1. Enable HTTPS/TLS

```python
# In backend/main.py
from fastapi.middleware.trustedhost import TrustedHostMiddleware

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["your-domain.com", "*.your-domain.com"]
)
```

Deploy with SSL:
```bash
# Using Fly.io (automatic)
fly deploy

# Or using Let's Encrypt + Nginx
apt-get install certbot python3-certbot-nginx
certbot certonly --nginx -d your-domain.com
```

### 2. Rate Limiting Enhancement

```python
# Already implemented, but you can tighten:
class RateLimitMiddleware(BaseHTTPMiddleware):
    # Reduce from 150 to 50 requests per minute for production
    if request_count >= 50:  # Changed from 150
        return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
```

### 3. API Keys for Signaling

```python
# Add secret key validation
@sio.event
async def p2p_connect(sid, data):
    api_key = data.get("api_key")
    if not validate_api_key(api_key):
        return False
```

### 4. Message Encryption

Add to p2p.js:
```javascript
// Using libsodium.js for encryption
import sodium from 'libsodium.js';

// Encrypt before sending
const encrypted = sodium.crypto_secretbox(
    sodium.from_string(message.content),
    nonce,
    key
);

message.encrypted = true;
message.content = sodium.to_base64(encrypted);
```

## 📊 Monitoring & Analytics

### Setup Logging

```python
# backend/main.py
import logging

logging.basicConfig(
    filename='messenger.log',
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

@sio.event
async def p2p_connect(sid, data):
    logger.info(f"User connected: {sid}")
```

### Monitor Performance

```javascript
// p2p.js - Add performance tracking
const stats = {
    connectionsOpened: 0,
    messagesSent: 0,
    messagesReceived: 0,
    connectionFailures: 0,
    averageLatency: 0
};

// Track in every event
sio.emit("p2p_stats", stats);
```

### View Logs

```bash
# Tail logs
tail -f messenger.log

# Or use ELK Stack for centralized logging
# Elasticsearch + Logstash + Kibana
```

## 🎯 Scaling Steps

### Phase 1: Basic P2P (Current)
- ✅ WebRTC signaling
- ✅ Local storage
- ✅ Direct messages

### Phase 2: Add Relay (1-3 weeks)
- Setup TURN server
- Implement offline relay
- Add message retry logic

```python
# backend/relay.py (new file)
class MessageRelay:
    def __init__(self):
        self.offline_messages = {}
    
    async def store_message(self, user_id, message):
        if user_id not in self.offline_messages:
            self.offline_messages[user_id] = []
        self.offline_messages[user_id].append(message)
    
    async def get_messages(self, user_id):
        messages = self.offline_messages.pop(user_id, [])
        return messages
```

### Phase 3: Add IPFS (2-4 weeks)
- Setup IPFS node
- Implement file archival
- Create backup system

```javascript
// static/p2p-ipfs.js (new file)
import IPFS from 'ipfs-core';

const ipfs = await IPFS.create();

async function archiveToIPFS(messageHistory) {
    const result = await ipfs.add({
        path: 'messages.json',
        content: JSON.stringify(messageHistory)
    });
    return result.cid.toString();
}
```

### Phase 4: Decentralization (Long-term)
- Remove central auth if needed
- Implement DHT for discovery
- Add blockchain verification

## 🆘 Troubleshooting Deployment

### Issue: WebRTC connections failing
```bash
# Check STUN/TURN reachability
nmap your-server.com -p 3478

# Test with tcpdump
tcpdump -i any -n 'port 3478'
```

### Issue: High memory usage
```bash
# Monitor process
docker stats

# Profile Python
python -m cProfile -o stats.prof backend/main.py
```

### Issue: Database too large
```bash
# Archive old messages
DELETE FROM messages WHERE created_at < date_sub(now(), interval 6 month);
VACUUM;  # SQLite

VACUUM ANALYZE;  # PostgreSQL
```

## 📋 Deployment Checklist

- [ ] Server has valid SSL certificate
- [ ] TURN server is configured (if needed)
- [ ] Database is backed up regularly
- [ ] Logging is enabled
- [ ] Rate limiting is configured
- [ ] CORS is restricted to known domains
- [ ] JWT secret key is strong and secret
- [ ] Monitoring is set up
- [ ] Disaster recovery plan exists
- [ ] Team has access to server/logs

## 📞 Support Resources

- WebRTC Docs: https://webrtc.org/getting-started/overview
- Coturn: https://github.com/coturn/coturn/wiki
- FastAPI: https://fastapi.tiangolo.com/
- Fly.io: https://fly.io/docs/
