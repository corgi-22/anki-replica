/**
 * gestures.js - 卡片觸控拖曳手勢與滑動評分系統
 * 支援手機觸控 (Touch) 與電腦滑鼠 (Mouse) 拖曳
 * 左滑 = 重來 (Again), 右滑 = 良好 (Good), 點擊 = 翻面
 */

import { triggerHaptic } from './tts.js';

export function attachCardGestures(cardElement, options = {}) {
  const { onSwipeLeft, onSwipeRight, onFlip } = options;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;

  const SWIPE_THRESHOLD = 90; // 滑動觸發門檻 (px)

  const badgeAgain = cardElement.querySelector('.badge-again');
  const badgeGood = cardElement.querySelector('.badge-good');

  function setCardTransform(x, y, animated = false) {
    if (animated) {
      cardElement.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease';
    } else {
      cardElement.style.transition = 'none';
    }

    const rotation = (x / 20).toFixed(2);
    cardElement.style.transform = `translate3d(${x}px, ${y * 0.2}px, 0) rotate(${rotation}deg)`;

    // 更新滑動標籤透明度
    if (badgeAgain && badgeGood) {
      if (x < -20) {
        badgeAgain.style.opacity = Math.min(1, Math.abs(x) / SWIPE_THRESHOLD);
        badgeGood.style.opacity = 0;
      } else if (x > 20) {
        badgeGood.style.opacity = Math.min(1, x / SWIPE_THRESHOLD);
        badgeAgain.style.opacity = 0;
      } else {
        badgeAgain.style.opacity = 0;
        badgeGood.style.opacity = 0;
      }
    }
  }

  function handleStart(clientX, clientY) {
    startX = clientX;
    startY = clientY;
    currentX = 0;
    currentY = 0;
    isDragging = true;
    startTime = Date.now();
  }

  function handleMove(clientX, clientY) {
    if (!isDragging) return;
    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    // 只有橫向位移大於縱向位移時才鎖定手勢，避免阻擋縱向滾動
    if (Math.abs(deltaX) > Math.abs(deltaY) || Math.abs(deltaX) > 10) {
      currentX = deltaX;
      currentY = deltaY;
      setCardTransform(currentX, currentY, false);
    }
  }

  function handleEnd() {
    if (!isDragging) return;
    isDragging = false;
    const duration = Date.now() - startTime;
    const moveDist = Math.hypot(currentX, currentY);

    // 判斷是否為點擊翻牌（位移小且時間短）
    if (moveDist < 10 && duration < 300) {
      setCardTransform(0, 0, true);
      triggerHaptic(15);
      if (onFlip) onFlip();
      return;
    }

    // 判斷滑動評分
    if (currentX < -SWIPE_THRESHOLD) {
      // 成功左滑 -> 重來
      triggerHaptic(25);
      setCardTransform(-window.innerWidth * 1.2, 0, true);
      cardElement.style.opacity = '0';
      setTimeout(() => {
        if (onSwipeLeft) onSwipeLeft();
      }, 250);
    } else if (currentX > SWIPE_THRESHOLD) {
      // 成功右滑 -> 良好
      triggerHaptic(25);
      setCardTransform(window.innerWidth * 1.2, 0, true);
      cardElement.style.opacity = '0';
      setTimeout(() => {
        if (onSwipeRight) onSwipeRight();
      }, 250);
    } else {
      // 未達門檻，彈回原位
      setCardTransform(0, 0, true);
      if (badgeAgain) badgeAgain.style.opacity = 0;
      if (badgeGood) badgeGood.style.opacity = 0;
    }
  }

  // Touch 事件 (手機)
  cardElement.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  }, { passive: true });

  cardElement.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  }, { passive: true });

  cardElement.addEventListener('touchend', () => {
    handleEnd();
  }, { passive: true });

  // Mouse 事件 (電腦瀏覽器調試支援)
  cardElement.addEventListener('mousedown', (e) => {
    handleStart(e.clientX, e.clientY);

    const onMouseMove = (moveEvent) => {
      handleMove(moveEvent.clientX, moveEvent.clientY);
    };

    const onMouseUp = () => {
      handleEnd();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}
