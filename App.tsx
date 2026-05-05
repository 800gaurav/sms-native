import { useEffect, useRef, useState } from 'react';
import {
  NativeModules,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

const { SmsModule, SmsService } = NativeModules;

// ⚠️ IMPORTANT: Change this to your computer's IP address
const BACKEND_HTTP = 'http://10.52.171.126:5000';
const BACKEND_WS   = 'ws://10.52.171.126:5000';
// const BACKEND_HTTP = 'https://api.sms.genzteck.com';
// const BACKEND_WS   = 'wss://api.sms.genzteck.com';

export default function App() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceBrand, setDeviceBrand] = useState<string>('');
  const [deviceModel, setDeviceModel] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('Detecting...');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [messagesSent, setMessagesSent] = useState<number>(0);
  const [battery, setBattery] = useState<number>(0);
  const [charging, setCharging] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initializeDevice();
  }, []);

  const initializeDevice = async () => {
    // Request all permissions first
    if (Platform.OS === 'android') {
      try {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.SEND_SMS,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS,
          PermissionsAndroid.PERMISSIONS.READ_SMS,
        ];
        
        // Add notification permission for Android 13+
        if (Platform.Version >= 33) {
          permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        }
        
        const results = await PermissionsAndroid.requestMultiple(permissions);
        if (results[PermissionsAndroid.PERMISSIONS.SEND_SMS] !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('SEND_SMS permission denied. SMS sending will not work.');
        }
        SmsService?.startService?.();
      } catch (err: any) {
        console.warn('Permission error:', err);
      }
    }

    // Get device info
    try {
      const id = await DeviceInfo.getUniqueId();
      const brand = await DeviceInfo.getBrand();
      const model = await DeviceInfo.getModel();
      
      setDeviceId(id);
      setDeviceBrand(brand);
      setDeviceModel(model);

      // Try multiple methods to get phone number
      let detectedNumber = '';
      
      // Method 1: DeviceInfo
      try {
        const num = await (DeviceInfo as any).getPhoneNumber?.();
        if (num && num.length > 3 && !num.includes('unknown')) {
          detectedNumber = num;
        }
      } catch {}

      // Method 2: Check saved number
      if (!detectedNumber) {
        const saved = await AsyncStorage.getItem('phoneNumber');
        if (saved) {
          detectedNumber = saved;
        }
      }

      // Method 3: Use device ID as fallback
      if (!detectedNumber) {
        detectedNumber = `Device_${id.slice(0, 8)}`;
      }

      setPhoneNumber(detectedNumber);
      await AsyncStorage.setItem('phoneNumber', detectedNumber);

      // Get battery info
      const batteryLevel = await DeviceInfo.getBatteryLevel();
      const isCharging = await DeviceInfo.isBatteryCharging();
      setBattery(Math.round(batteryLevel * 100));
      setCharging(isCharging);

      // Load message count
      const count = await AsyncStorage.getItem('messagesSent');
      if (count) setMessagesSent(parseInt(count));

      // Update battery every 30 seconds
      const batteryInterval = setInterval(async () => {
        try {
          const level = await DeviceInfo.getBatteryLevel();
          const charging = await DeviceInfo.isBatteryCharging();
          setBattery(Math.round(level * 100));
          setCharging(charging);
        } catch {}
      }, 30000);

      return () => clearInterval(batteryInterval);
    } catch (error) {
      console.error('Device init error:', error);
    }
  };

  useEffect(() => {
    if (!deviceId || !phoneNumber || phoneNumber === 'Detecting...') return;
    connect();

    const tokenRefreshUnsubscribe = messaging().onTokenRefresh(async (token) => {
      console.log('FCM Token refreshed:', token?.substring(0, 20) + '...');
      await registerDeviceHttp(token);
      connect();
    });

    // FCM foreground messages
    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      const { type, phone, message } = remoteMessage.data || {};
      if (type === 'send_sms' && typeof phone === 'string' && typeof message === 'string') {
        const hasPermission = await requestSmsPermission();
        if (hasPermission) {
          await sendSms(phone, message);
        }
      }
    });

    return () => {
      unsubscribe();
      tokenRefreshUnsubscribe();
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, phoneNumber]);

  const requestSmsPermission = async () => {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      { title: 'SMS Permission', message: 'App needs to send SMS', buttonPositive: 'Allow' }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const sendSms = async (phone: string, message: string) => {
    if (!SmsModule?.sendSms) {
      console.log('SMS native module is not available');
      return false;
    }
    try {
      await SmsModule.sendSms(phone, message);
      setMessagesSent(prev => {
        const newCount = prev + 1;
        AsyncStorage.setItem('messagesSent', newCount.toString());
        return newCount;
      });
      return true;
    } catch (err: any) {
      console.log('SMS send failed:', err?.message || err);
      return false;
    }
  };

  const registerDeviceHttp = async (fcmToken: string | null) => {
    if (!deviceId || !phoneNumber || phoneNumber === 'Detecting...') return false;

    try {
      const currentBattery = await DeviceInfo.getBatteryLevel();
      const isCharging = await DeviceInfo.isBatteryCharging();
      const response = await fetch(`${BACKEND_HTTP}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          deviceName: `${deviceBrand} ${deviceModel}`,
          phoneNumber,
          battery: Math.round(currentBattery * 100),
          charging: isCharging,
          network: 'WiFi',
          fcmToken,
        }),
      });

      if (response.ok) {
        console.log('Device registered via HTTP');
        return true;
      }

      console.log('HTTP registration failed');
    } catch (err: any) {
      console.log('HTTP registration error:', err.message);
    }

    return false;
  };

  const connect = async () => {
    if (!deviceId || !phoneNumber || phoneNumber === 'Detecting...') {
      console.log('❌ Cannot connect: Missing deviceId or phoneNumber');
      return;
    }
    
    // Close existing connection
    if (wsRef.current) {
      console.log('🔄 Closing old connection');
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    
    // Clear reconnect timer
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    
    setStatus('connecting');
    console.log('🔌 Connecting to:', BACKEND_WS);
    console.log('📱 Device ID:', deviceId);
    console.log('📞 Phone:', phoneNumber);

    // Get FCM token (fixed deprecated warning)
    let fcmToken = null;
    try {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      
      if (enabled) {
        fcmToken = await messaging().getToken();
        console.log('✅ FCM Token obtained:', fcmToken?.substring(0, 20) + '...');
      }
    } catch (err: any) {
      console.log('⚠️ FCM error:', err.message);
    }

    await registerDeviceHttp(fcmToken);

    // If no WebSocket URL or it's a production domain, use FCM-only mode
    if (!BACKEND_WS || BACKEND_WS.includes('genzteck.com')) {
      console.log('📡 Using FCM-only mode (no WebSocket)');
      
      // Register device via HTTP
      try {
        const response = await fetch(`${BACKEND_HTTP}/devices/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            deviceName: `${deviceBrand} ${deviceModel}`,
            phoneNumber,
            battery,
            charging,
            network: 'WiFi',
            fcmToken,
          }),
        });
        
        if (response.ok) {
          console.log('✅ Device registered via HTTP');
          setStatus('connected');
        } else {
          console.log('❌ HTTP registration failed');
          setStatus('disconnected');
        }
      } catch (err: any) {
        console.log('❌ HTTP registration error:', err.message);
        setStatus('disconnected');
      }
      return;
    }

    try {
      console.log('🔗 Creating WebSocket...');
      const ws = new WebSocket(BACKEND_WS);
      wsRef.current = ws;
      
      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('⏱️ Connection timeout - closing');
          ws.close();
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('✅ WebSocket CONNECTED!');
        setStatus('connected');
        
        const registerData = {
          type: 'register',
          deviceId: deviceId,
          userId: 'admin',
          deviceName: `${deviceBrand} ${deviceModel}`,
          phoneNumber: phoneNumber,
          battery: battery,
          charging: charging,
          network: 'WiFi',
          fcmToken,
        };
        
        console.log('📤 Sending register:', JSON.stringify(registerData, null, 2));
        ws.send(JSON.stringify(registerData));
      };

      ws.onmessage = async (e) => {
        console.log('📥 Message received:', e.data);
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'registered') {
            console.log('✅ Device registered successfully');
          }

          if (data.type === 'send_sms') {
            console.log('📨 SMS request for:', data.phone);
            const { phone, message } = data;
            const hasPermission = await requestSmsPermission();
            if (!hasPermission) {
              console.log('❌ SMS permission denied');
              return;
            }
            await sendSms(phone, message);
          }

          if (data.type === 'ping') {
            console.log('🏓 Ping received, sending pong');
            try {
              const currentBattery = await DeviceInfo.getBatteryLevel();
              const isCharging = await DeviceInfo.isBatteryCharging();
              const newBattery = Math.round(currentBattery * 100);
              setBattery(newBattery);
              setCharging(isCharging);
              
              ws.send(JSON.stringify({ 
                type: 'pong', 
                deviceId: deviceId, 
                battery: newBattery, 
                charging: isCharging, 
                network: 'WiFi' 
              }));
            } catch {
              ws.send(JSON.stringify({ 
                type: 'pong', 
                deviceId: deviceId, 
                battery: battery, 
                charging: charging, 
                network: 'WiFi' 
              }));
            }
          }
        } catch (err: any) {
          console.log('❌ Message parse error:', err.message);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.log('❌ WebSocket ERROR:', error.message);
        setStatus('disconnected');
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('🔴 WebSocket CLOSED');
        console.log('   Code:', event.code);
        console.log('   Reason:', event.reason || 'No reason provided');
        console.log('   Clean:', (event as any).wasClean);
        
        setStatus('disconnected');
        wsRef.current = null;
        
        // Reconnect if not manually closed
        if (event.code !== 1000 && reconnectTimer.current === null) {
          console.log('⏰ Reconnecting in 5 seconds...');
          reconnectTimer.current = setTimeout(() => {
            reconnectTimer.current = null;
            console.log('🔄 Attempting reconnect...');
            connect();
          }, 5000);
        }
      };
    } catch (err: any) {
      console.log('❌ WebSocket creation failed:', err.message);
      setStatus('disconnected');
      wsRef.current = null;
      
      if (reconnectTimer.current === null) {
        console.log('⏰ Retry in 5 seconds...');
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          connect();
        }, 5000);
      }
    }
  };

  const statusColor = status === 'connected' ? '#10b981' : status === 'connecting' ? '#f59e0b' : '#ef4444';
  const statusText = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected';
  const statusIcon = status === 'connected' ? '●' : status === 'connecting' ? '◐' : '○';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>💬</Text>
          <Text style={styles.title}>SMS Sender</Text>
          <Text style={styles.subtitle}>Professional Edition</Text>
        </View>

        {/* Status Card */}
        <View style={[styles.statusCard, { borderColor: statusColor }]}>
          <View style={styles.statusRow}>
            <Text style={[styles.statusDot, { color: statusColor }]}>{statusIcon}</Text>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
          </View>
          {status === 'connected' && (
            <Text style={styles.statusSubtext}>✓ Ready to send messages</Text>
          )}
          {status === 'disconnected' && (
            <Text style={styles.statusSubtext}>⟳ Reconnecting...</Text>
          )}
        </View>

        {/* Device Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DEVICE INFORMATION</Text>
          
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>📱 Device</Text>
              <Text style={styles.infoValue}>{deviceBrand} {deviceModel}</Text>
            </View>
            
            <View style={styles.divider} />
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>📞 Phone Number</Text>
              <Text style={styles.infoValue}>{phoneNumber}</Text>
            </View>
            
            <View style={styles.divider} />
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>🆔 Unique ID</Text>
              <Text style={styles.infoValueSmall}>{deviceId.slice(0, 20)}...</Text>
            </View>
            
            <View style={styles.divider} />
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{charging ? '⚡ Charging' : '🔋 Battery'}</Text>
              <Text style={[styles.infoValue, { color: battery < 20 ? '#ef4444' : battery < 50 ? '#f59e0b' : '#10b981' }]}>
                {battery}%
              </Text>
            </View>
            
            <View style={styles.divider} />
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>📤 Messages Sent</Text>
              <Text style={styles.infoValue}>{messagesSent.toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* Server Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SERVER CONNECTION</Text>
          <View style={styles.serverCard}>
            <Text style={styles.serverLabel}>Backend URL</Text>
            <Text style={styles.serverUrl}>{BACKEND_HTTP}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            ℹ️ This device is managed by the admin dashboard. All messages are sent automatically when commanded from the web interface.
          </Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  
  header: { alignItems: 'center', marginBottom: 30, marginTop: 10 },
  logo: { fontSize: 56, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: '#f1f5f9', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: '#6366f1', marginTop: 4, fontWeight: '600' },
  
  statusCard: { 
    backgroundColor: '#1e293b', 
    borderRadius: 16, 
    padding: 24, 
    marginBottom: 24,
    borderWidth: 3,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  statusDot: { fontSize: 28, marginRight: 10 },
  statusText: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statusSubtext: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#64748b', marginBottom: 12, letterSpacing: 1.5 },
  
  infoCard: { 
    backgroundColor: '#1e293b', 
    borderRadius: 14, 
    padding: 18, 
    borderWidth: 1, 
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  infoLabel: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  infoValue: { fontSize: 16, color: '#f1f5f9', fontWeight: '700' },
  infoValueSmall: { fontSize: 11, color: '#f1f5f9', fontWeight: '600', fontFamily: 'monospace' },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 2 },
  
  serverCard: { 
    backgroundColor: '#1e293b', 
    borderRadius: 14, 
    padding: 18, 
    borderWidth: 1, 
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  serverLabel: { fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: '600', letterSpacing: 0.5 },
  serverUrl: { fontSize: 13, color: '#6366f1', fontFamily: 'monospace', fontWeight: '600' },
  
  footer: { 
    backgroundColor: '#1e293b', 
    borderRadius: 14, 
    padding: 18, 
    borderWidth: 1, 
    borderColor: '#334155',
    marginTop: 'auto',
  },
  footerText: { fontSize: 12, color: '#94a3b8', lineHeight: 18, textAlign: 'center' },
});
