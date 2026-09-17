import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';

export default function CropModal({
    imageSrc,
    onCancel,
    onCropComplete
}: {
    imageSrc: string;
    onCancel: () => void;
    onCropComplete: (croppedImgInfo: { x: number; y: number; width: number; height: number; zoom: number }) => void;
}) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<{ x: number, y: number, width: number, height: number } | null>(null);

    const handleCropComplete = useCallback((croppedArea: any, croppedPixels: any) => {
        setCroppedAreaPixels(croppedPixels);
    }, []);

    const handleSave = () => {
        if (!croppedAreaPixels) return;
        onCropComplete({
            x: croppedAreaPixels.x,
            y: croppedAreaPixels.y,
            width: croppedAreaPixels.width,
            height: croppedAreaPixels.height,
            zoom
        });
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: '#000', zIndex: 20000, display: 'flex', flexDirection: 'column'
        }}>
            <div style={{
                padding: '16px', color: '#fff', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', zIndex: 20002, background: 'rgba(0,0,0,0.8)'
            }}>
                <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 16 }}>Отмена</button>
                <div style={{ fontWeight: 600 }}>Редактирование</div>
                <button onClick={handleSave} style={{ background: 'none', border: 'none', color: 'var(--tg-link, #007aff)', fontSize: 16, fontWeight: 600 }}>
                    Сохранить
                </button>
            </div>

            <div style={{ position: 'relative', flex: 1 }}>
                <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    cropShape="round"
                    showGrid={false}
                    onCropChange={setCrop}
                    onCropComplete={handleCropComplete}
                    onZoomChange={setZoom}
                />
            </div>

            <div style={{ padding: '32px 16px', zIndex: 20002, background: 'rgba(0,0,0,0.8)' }}>
                <input
                    type="range" min="1" max="3" step="0.05" value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>
        </div>
    );
}
