/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useState, useRef } from 'react';
import { SafeAreaView, StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, FlatList, Keyboard, Image, Vibration, AppState, AppStateStatus } from 'react-native';
// import MapView, { Marker } from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import { magnetometer, accelerometer, setUpdateIntervalForType, SensorTypes, gyroscope } from 'react-native-sensors';

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const toDeg = (rad: number) => rad * (180 / Math.PI);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let brng = Math.atan2(y, x);
  brng = toDeg(brng);
  return (brng + 360) % 360;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000; // 地球の半径（メートル）
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// 角度差の最短差（-180..+180）
function shortestAngleDiffDeg(a: number, b: number) {
  return ((a - b + 540) % 360) - 180;
}

// 角度ブレンド（循環角度対応） weight: 0..1 で b 寄り
function blendAnglesDeg(a: number, b: number, weight: number) {
  const diff = shortestAngleDiffDeg(b, a); // a -> b
  const blended = (a + diff * Math.min(Math.max(weight, 0), 1) + 360) % 360;
  return blended;
}

function getArrowByDirection(degree: number) {
  if (degree < 22.5 || degree >= 337.5) return '↑';
  if (degree < 67.5) return '↗';
  if (degree < 112.5) return '→';
  if (degree < 157.5) return '↘';
  if (degree < 202.5) return '↓';
  if (degree < 247.5) return '↙';
  if (degree < 292.5) return '←';
  return '↖';
}


export default function App() {
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [destination, setDestination] = useState<{ latitude: number; longitude: number }>({ latitude: 35.6812, longitude: 139.7671 });
  const [heading, setHeading] = useState<number | null>(null);
  const [destName, setDestName] = useState('東京駅');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDestinationSet, setIsDestinationSet] = useState(false);
  const [gpsHeading, setGpsHeading] = useState<number | null>(null);
  const [gpsSpeed, setGpsSpeed] = useState<number>(0); // m/s
  const prevGpsRef = useRef<{ lat: number; lon: number; time: number } | null>(null);
  const [declinationDeg, setDeclinationDeg] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null); // m
  const lastHapticMsRef = useRef<number>(0);
  const [isAligned, setIsAligned] = useState<boolean>(false);
  // const mapRef = useRef<any>(null);
  const [hasArrived, setHasArrived] = useState<boolean>(false);
  const arrivalBuzzedRef = useRef<boolean>(false);
  const gpsWatchIdRef = useRef<any>(null);
  const suppressHapticsRef = useRef<boolean>(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // GPSの連続監視（速度・進行方位）
  const startGpsWatch = () => {
    if (gpsWatchIdRef.current !== null) return;
    const watchId = Geolocation.watchPosition(
      pos => {
        const { latitude, longitude, speed, heading: course, accuracy } = pos.coords as any;
        const timestampMs = pos.timestamp || Date.now();
        const cur = { lat: latitude, lon: longitude, time: timestampMs };
        setGpsAccuracy(typeof accuracy === 'number' && isFinite(accuracy) ? accuracy : null);

        // 速度推定（提供されない端末では距離/時間）
        let v = typeof speed === 'number' && isFinite(speed) ? speed : 0;
        const prev = prevGpsRef.current;
        if ((!v || v <= 0) && prev) {
          const dt = Math.max(0.001, (cur.time - prev.time) / 1000);
          const d = calculateDistance(prev.lat, prev.lon, cur.lat, cur.lon); // m
          v = d / dt;
        }
        setGpsSpeed(v);

        // コース（真北基準が期待、未提供なら自己算出）
        let courseDeg: number | null = null;
        if (typeof course === 'number' && isFinite(course) && course >= 0) {
          courseDeg = course; // 0..360
        } else if (prev) {
          courseDeg = calculateBearing(prev.lat, prev.lon, cur.lat, cur.lon);
        }
        if (courseDeg !== null) setGpsHeading(courseDeg);

        prevGpsRef.current = cur;
        setLocation({ latitude, longitude });
      },
      () => {},
      {
        enableHighAccuracy: true,
        distanceFilter: 1,
        interval: 500,
        fastestInterval: 250,
        useSignificantChanges: false,
      } as any
    );
    gpsWatchIdRef.current = watchId;
  };

  const stopGpsWatch = () => {
    const id = gpsWatchIdRef.current;
    if (id !== null) {
      if (typeof id === 'number') Geolocation.clearWatch(id as any);
      else Geolocation.stopObserving();
      gpsWatchIdRef.current = null;
    }
  };

  useEffect(() => {
    startGpsWatch();
    return () => stopGpsWatch();
  }, []);

  // 磁気偏角の取得（ロケーション更新時）
  useEffect(() => {
    const fetchDeclination = async () => {
      if (!location) return;
      try {
        const date = new Date();
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const url = `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${location.latitude}&lon1=${location.longitude}&resultFormat=json&startYear=${dateStr}&endYear=${dateStr}&key=anonymous`;
        const res = await fetch(url);
        const data = await res.json();
        const dec = data?.result?.[0]?.declination; // 度
        if (typeof dec === 'number' && isFinite(dec)) {
          setDeclinationDeg(dec);
        } else {
          setDeclinationDeg(0);
        }
      } catch (e) {
        setDeclinationDeg(0);
      }
    };
    fetchDeclination();
  }, [location]);

  // 角度の指数移動平均（循環角度対応）
  const smoothAngleRef = useRef<number | null>(null);
  const alphaRef = useRef<number>(0.2); // 動的に変更
  const smoothAngle = (prevDeg: number | null, nextDeg: number) => {
    if (prevDeg === null) return nextDeg;
    const diff = ((nextDeg - prevDeg + 540) % 360) - 180; // 最短回転差
    const a = Math.max(0.05, Math.min(0.5, alphaRef.current));
    const smoothed = (prevDeg + a * diff + 360) % 360;
    return smoothed;
  };

  // チルト補正付き方位算出
  const latestAccRef = useRef<{ ax: number; ay: number; az: number } | null>(null);
  const accMagWindowRef = useRef<number[]>([]);
  const [motionState, setMotionState] = useState<'still' | 'walk' | 'run'>('still');

  // 短時間窓の角度ベクトル平均でスパイク除去
  const headingSamplesRef = useRef<number[]>([]);
  const HEADING_WINDOW_SIZE = 7; // 奇数推奨
  const averageAnglesDeg = (angles: number[]) => {
    if (angles.length === 0) return null as unknown as number;
    let sumSin = 0;
    let sumCos = 0;
    for (const a of angles) {
      const rad = (a * Math.PI) / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);
    }
    const avgRad = Math.atan2(sumSin / angles.length, sumCos / angles.length);
    let deg = (avgRad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  };

  // 補完フィルタ用：最新の磁気方位、融合方位、ジャイロ時刻
  const latestMagHeadingRef = useRef<number | null>(null);
  const fusedHeadingRef = useRef<number | null>(null);
  const lastGyroTsRef = useRef<number | null>(null);

  useEffect(() => {
    // センサー更新間隔（ms）- iOS最適化
    try {
      setUpdateIntervalForType(SensorTypes.magnetometer, 50);  // より高頻度で磁気センサーを取得
      setUpdateIntervalForType(SensorTypes.accelerometer, 50); // より高頻度で加速度センサーを取得
      setUpdateIntervalForType(SensorTypes.gyroscope, 25);     // より高頻度でジャイロセンサーを取得
    } catch (_) {}

    let magSub: any = null;
    let accSub: any = null;
    let gyroSub: any = null;
    let isActive = true;

    // 加速度
    try {
      accSub = accelerometer.subscribe(
        ({ x, y, z }) => {
          if (!isActive) return;
          latestAccRef.current = { ax: x, ay: y, az: z };

          // 動作状態推定（加速度の大きさの分散/標準偏差）
          const mag = Math.sqrt(x * x + y * y + z * z);
          const arr = accMagWindowRef.current;
          arr.push(mag);
          if (arr.length > 32) arr.shift(); // 約3秒分（100ms間隔想定）
          if (arr.length >= 16) {
            const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
            const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
            const std = Math.sqrt(variance);
            // 簡易閾値（端末差あり）
            let m: 'still' | 'walk' | 'run' = 'still';
            if (std > 0.5 && std <= 1.2) m = 'walk';
            else if (std > 1.2) m = 'run';
            if (m !== motionState) setMotionState(m);

            // 動作＋GPS精度に応じてスムージングを自動調整
            // 基本: 静止0.12, 歩行0.20, 走行0.30
            let targetAlpha = m === 'still' ? 0.12 : m === 'walk' ? 0.20 : 0.30;
            // GPSが不安定（精度悪い）な場合はさらに強めにスムージング
            if (gpsAccuracy !== null && gpsAccuracy > 30) {
              targetAlpha *= 0.7; // より滑らかに
            }
            alphaRef.current = targetAlpha;
          }
        },
        () => {}
      );
    } catch (_) {}

    // 磁気 + チルト補正
    try {
      magSub = magnetometer.subscribe(
        ({ x, y, z }) => {
          if (!isActive) return;


          const acc = latestAccRef.current;
          if (!acc) {
            // 加速度未取得時は水平前提
            const angle = Math.atan2(y, x) * (180 / Math.PI);
            const deg = angle >= 0 ? angle : angle + 360;
            // 窓平均でスパイク抑制
            const arr = headingSamplesRef.current;
            arr.push(deg);
            if (arr.length > HEADING_WINDOW_SIZE) arr.shift();
            const denoised = averageAnglesDeg(arr) ?? deg;
            latestMagHeadingRef.current = denoised;
            if (fusedHeadingRef.current === null) {
              fusedHeadingRef.current = denoised;
              setHeading(denoised);
            }
            return;
          }

          // 正規化（簡易）
          const mx = x;
          const my = y;
          const mz = z;
          const ax = acc.ax;
          const ay = acc.ay;
          const az = acc.az;

          // ロール・ピッチ推定
          const roll = Math.atan2(ay, az);
          const pitch = Math.atan(-ax / (ay * Math.sin(roll) + az * Math.cos(roll)));

          // 磁気のチルト補正
          const mx2 = mx * Math.cos(pitch) + mz * Math.sin(pitch);
          const my2 = mx * Math.sin(roll) * Math.sin(pitch) + my * Math.cos(roll) - mz * Math.sin(roll) * Math.cos(pitch);

          let headingDeg = Math.atan2(-my2, mx2) * (180 / Math.PI); // 方位角（度）
          if (headingDeg < 0) headingDeg += 360;

          // 窓平均でスパイク抑制（循環角度対応）
          const arr = headingSamplesRef.current;
          arr.push(headingDeg);
          if (arr.length > HEADING_WINDOW_SIZE) arr.shift();
          const denoised = averageAnglesDeg(arr) ?? headingDeg;
          latestMagHeadingRef.current = denoised;
          if (fusedHeadingRef.current === null) {
            fusedHeadingRef.current = denoised;
            setHeading(denoised);
          }
        },
        () => {
          setHeading(null);
        }
      );
    } catch (_) {
      setHeading(null);
    }

    // ジャイロ：積分 + 磁気へのゆっくり補正（補完フィルタ）
    try {
      gyroSub = gyroscope.subscribe(
        ({ x, y, z, timestamp }) => {
          if (!isActive) return;
          const now = typeof timestamp === 'number' ? timestamp : Date.now();
          const last = lastGyroTsRef.current;
          lastGyroTsRef.current = now;
          if (last === null) return;
          const dt = Math.max(0.001, (now - last) / 1000); // s

          // z軸回転を度/秒として仮定（端末によりrad/sの場合あり）。単位差の影響を抑えるため小さめのゲインで補正。
          const zDegPerSec = z; // 必要に応じてスケール調整
          let fused = fusedHeadingRef.current;
          if (fused === null) {
            const init = latestMagHeadingRef.current;
            if (init !== null) {
              fused = init;
              fusedHeadingRef.current = init;
            } else {
              return;
            }
          }
          // 積分
          fused = (fused + zDegPerSec * dt + 360) % 360;
          // ドリフト補正（磁気へ微小に寄せる）
          const mag = latestMagHeadingRef.current;
          if (mag !== null) {
            const correctionWeightPerStep = 0.03; // 0..1 小さいほどジャイロ優先
            fused = blendAnglesDeg(fused, mag, correctionWeightPerStep);
          }

          fusedHeadingRef.current = fused;
          setHeading(fused);
        },
        () => {}
      );
    } catch (_) {}

    return () => {
      isActive = false;
      if (magSub) magSub.unsubscribe();
      if (accSub) accSub.unsubscribe();
      if (gyroSub) gyroSub.unsubscribe();
    };
  }, []);

  // サジェスト取得
  useEffect(() => {
    if (destName.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destName)}`);
        const data = await res.json();
        setSuggestions(data);
        setShowSuggestions(true);
      } catch (e) {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 400); // 入力後400ms待ってからAPI呼び出し
    return () => clearTimeout(timer);
  }, [destName]);


  let bearing = null;
  let directionDiff = null;
  let distance = null;
  const isGpsReliable = gpsAccuracy !== null ? gpsAccuracy <= 30 : true; // 30m以内を信頼
  if (location && destination) {
    bearing = calculateBearing(
      location.latitude,
      location.longitude,
      destination.latitude,
      destination.longitude
    );
    distance = calculateDistance(
      location.latitude,
      location.longitude,
      destination.latitude,
      destination.longitude
    );
    // 効き方の決定：移動時はGPS方位をブレンド
    let effectiveHeading: number | null = heading;
    if (heading !== null) {
      // 磁気→真北に補正
      const trueHeading = (heading + declinationDeg + 360) % 360;
      const v = gpsSpeed || 0;
      const gpsH = gpsHeading;
      // 速度に応じた重み（0.6 m/s から 1.5 m/s で0→1へ）
      let w = 0;
      if (v >= 0.6) w = Math.min(1, (v - 0.6) / (1.5 - 0.6));
      // GPS精度が悪ければブレンド抑制
      if (!isGpsReliable) w = 0;
      effectiveHeading = trueHeading;
      if (gpsH !== null && w > 0) {
        effectiveHeading = blendAnglesDeg(trueHeading, gpsH, w);
      }
    }
    if (effectiveHeading !== null) {
      directionDiff = (bearing - effectiveHeading + 360) % 360;
    }
  }

  // 一致時ハプティック（簡易バイブ）。10°以内で2秒に1回まで。
  useEffect(() => {
    if (directionDiff === null || hasArrived) return;
    const alignedNow = directionDiff < 10 || directionDiff > 350;
    setIsAligned(alignedNow);
    if (alignedNow) {
      const now = Date.now();
      if (now - lastHapticMsRef.current > 2000) {
        if (!suppressHapticsRef.current) Vibration.vibrate(20);
        lastHapticMsRef.current = now;
      }
    }
  }, [directionDiff, hasArrived]);

  // 到着判定と到着フィードバック
  const ARRIVAL_THRESHOLD_M = 20; // 到着判定
  const NEAR_THRESHOLD_M = 80; // 近距離表示
  useEffect(() => {
    if (distance === null) return;
    if (distance <= ARRIVAL_THRESHOLD_M) {
      if (!hasArrived) setHasArrived(true);
      if (!arrivalBuzzedRef.current) {
        if (!suppressHapticsRef.current) Vibration.vibrate([0, 60, 50, 60]);
        arrivalBuzzedRef.current = true;
      }
    } else {
      if (hasArrived) setHasArrived(false);
      arrivalBuzzedRef.current = false;
    }
  }, [distance]);

  // 地図は非表示コンセプトのため追従ロジックは撤去

  // 矢印の回転角度
  let arrowRotation = 0;
  if (directionDiff !== null) {
    arrowRotation = directionDiff;
  }

  // サジェストから選択
  const handleSelectSuggestion = (item: any) => {
    setDestination({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) });
    setDestName(item.display_name);
    setShowSuggestions(false);
    setSuggestions([]);
    Keyboard.dismiss();
    setIsDestinationSet(true);
  };

  // 名称からジオコーディング（ボタン押下時）
  const handleSetDestination = async () => {
    if (!destName.trim()) {
      Alert.alert('エラー', '目的地名称を入力してください');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destName)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        setDestination({ latitude: lat, longitude: lon });
        setIsDestinationSet(true);
        Keyboard.dismiss();
      } else {
        Alert.alert('エラー', '該当する場所が見つかりませんでした');
      }
    } catch (e) {
      Alert.alert('エラー', 'ジオコーディングに失敗しました');
    }
    setIsLoading(false);
    setShowSuggestions(false);
  };

  // AppStateによる省電力制御
  useEffect(() => {
    const onChange = (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      const isActive = nextState === 'active';
      // ハプティック抑止
      suppressHapticsRef.current = !isActive;
      // センサー更新間隔の調整 - iOS最適化
      try {
        if (isActive) {
          setUpdateIntervalForType(SensorTypes.magnetometer, 50);
          setUpdateIntervalForType(SensorTypes.accelerometer, 50);
          setUpdateIntervalForType(SensorTypes.gyroscope, 25);
        } else {
          setUpdateIntervalForType(SensorTypes.magnetometer, 100);
          setUpdateIntervalForType(SensorTypes.accelerometer, 100);
          setUpdateIntervalForType(SensorTypes.gyroscope, 50);
        }
      } catch (_) {}
      // GPSウォッチの制御（バックグラウンドでは停止）
      if (isActive) startGpsWatch(); else stopGpsWatch();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDarkMode ? '#000000' : '#FFFFFF' }]}>
      {!isDestinationSet && (
        <View style={[styles.inputCard, { backgroundColor: isDarkMode ? '#1a1a1a' : '#FFFFFF' }]}>
          <Text style={[styles.label, { color: isDarkMode ? '#FFFFFF' : '#333333' }]}>目的地の名称（例：東京駅、渋谷スクランブル交差点）</Text>
          <TextInput
            style={[styles.input, { 
              backgroundColor: isDarkMode ? '#2a2a2a' : '#f9f9f9',
              borderColor: isDarkMode ? '#444' : '#ccc',
              color: isDarkMode ? '#FFFFFF' : '#000000'
            }]}
            value={destName}
            onChangeText={text => { setDestName(text); setShowSuggestions(true); }}
            placeholder="目的地の名称を入力"
            returnKeyType="search"
            onSubmitEditing={() => {
              if (showSuggestions && suggestions.length > 0) {
                handleSelectSuggestion(suggestions[0]);
              } else {
                handleSetDestination();
              }
            }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <FlatList
              data={suggestions}
              keyExtractor={(item, index) => {
                const pid = (item as any)?.place_id;
                if (pid !== undefined && pid !== null && typeof pid.toString === 'function') return pid.toString();
                const lat = (item as any)?.lat;
                const lon = (item as any)?.lon;
                if (lat && lon) return `${lat},${lon}`;
                return String(index);
              }}
              style={styles.suggestionList}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.suggestionItem} onPress={() => handleSelectSuggestion(item)}>
                  <Text style={styles.suggestionText}>{item.display_name}</Text>
                </TouchableOpacity>
              )}
            />
          )}
          <View style={styles.settingsContainer}>
            <Text style={[styles.settingsLabel, { color: isDarkMode ? '#FFFFFF' : '#333333' }]}>テーマ設定</Text>
            <View style={styles.themeOptions}>
              <TouchableOpacity 
                style={[styles.themeOption, isDarkMode ? styles.themeOptionInactive : styles.themeOptionActive]}
                onPress={() => setIsDarkMode(false)}
              >
                <Text style={[styles.themeOptionText, { color: isDarkMode ? '#666' : '#FFFFFF' }]}>ライトモード</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.themeOption, isDarkMode ? styles.themeOptionActive : styles.themeOptionInactive]}
                onPress={() => setIsDarkMode(true)}
              >
                <Text style={[styles.themeOptionText, { color: isDarkMode ? '#FFFFFF' : '#666' }]}>ダークモード</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={[styles.button, { 
            backgroundColor: isDarkMode ? '#333333' : '#000000',
            borderColor: isDarkMode ? '#555555' : '#000000'
          }]} onPress={handleSetDestination} disabled={isLoading}>
            {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>目的地を設定</Text>}
          </TouchableOpacity>

        </View>
      )}
      {isDestinationSet && (
        <View style={styles.card}>
          {heading === null && (
            <Text style={{ color: 'red', marginBottom: 4 }}>コンパスセンサーが利用できません（実機でご確認ください）</Text>
          )}
          <View style={styles.arrowContainer}>
            <Image
              source={isDarkMode ? require('./assets/arrow_dark.png') : require('./assets/arrow_light.png')}
              style={[styles.arrowImg, { transform: [{ rotate: `${arrowRotation}deg` }] }]}
              resizeMode="contain"
            />
          </View>
          
          <Text style={[styles.destinationNameText, { color: isDarkMode ? '#FFFFFF' : '#000000' }]}>
            {destName}
          </Text>
          <Text style={[styles.distanceText, { color: isDarkMode ? '#FFFFFF' : '#000000' }]}>
            目的地までの距離: {distance !== null ? `${distance} m` : '計算中…'}
          </Text>
          {distance !== null && !hasArrived && distance <= NEAR_THRESHOLD_M && (
            <Text style={[styles.nearText, { color: isDarkMode ? '#FFFFFF' : '#000000' }]}>目的地が近くにあります</Text>
          )}
          {hasArrived && (
            <View style={[styles.arrivalContainer, { 
              backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              borderColor: isDarkMode ? '#FFFFFF' : '#000000'
            }]}>
              <Text style={[styles.arrivalText, { color: isDarkMode ? '#FFFFFF' : '#000000' }]}>到着しました</Text>
            </View>
          )}


        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  card: {
    backgroundColor: 'transparent',
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationNameText: { fontSize: 14, color: '#FFFFFF', marginBottom: 6, fontWeight: '400', textAlign: 'center' },
  distanceText: { fontSize: 16, color: '#FFFFFF', marginBottom: 8, fontWeight: '500', textAlign: 'center' },
  inputCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  label: { fontSize: 14, marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 8, marginTop: 4, backgroundColor: '#f9f9f9' },
  button: { backgroundColor: '#007AFF', padding: 14, borderRadius: 5, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  coordCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  coordText: { fontSize: 14, color: '#555', marginBottom: 2 },
  arrowContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 40, marginBottom: 20 },
  arrowImg: { width: 120, height: 120 },
  nearText: { marginTop: 8, color: '#FFFFFF', fontWeight: '600', fontSize: 16, textAlign: 'center' },
  arrivalContainer: { marginTop: 12, backgroundColor: 'rgba(255, 255, 255, 0.1)', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: '#FFFFFF' },
  arrivalText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 18, textAlign: 'center' },
  suggestionList: { maxHeight: 120, backgroundColor: '#fff', borderRadius: 8, marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  suggestionItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  suggestionText: { fontSize: 14, color: '#333' },
  settingsContainer: { marginTop: 20, marginBottom: 16 },
  settingsLabel: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#333' },
  themeOptions: { flexDirection: 'row', justifyContent: 'space-between' },
  themeOption: { 
    flex: 1, 
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderRadius: 8, 
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1
  },
  themeOptionActive: { backgroundColor: '#666666', borderColor: '#666666' },
  themeOptionInactive: { backgroundColor: '#f0f0f0', borderColor: '#ddd' },
  themeOptionText: { fontSize: 14, fontWeight: '600' },
});
