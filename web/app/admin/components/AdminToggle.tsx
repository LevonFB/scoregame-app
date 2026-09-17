import React from "react";

export function AdminToggle({ 
  checked, 
  onChange, 
  disabled = false,
  id 
}: { 
  checked: boolean, 
  onChange: (checked: boolean) => void,
  disabled?: boolean,
  id?: string
}) {
  return (
    <div 
      id={id}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`w-12 h-6 rounded-full p-1 transition-colors relative flex items-center shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${checked ? 'bg-[#34c759]' : 'bg-white/20'}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div 
        className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${checked ? 'translate-x-5' : 'translate-x-0'}`} 
      />
    </div>
  );
}
