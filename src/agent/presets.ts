// 队友 2：7 个零 Token 预置案例（离线可用，不消耗任何大模型额度）。
// 每个案例包含完整蓝图、Mermaid 状态图、教学子集 Verilog、自测向量与故障诊所关卡。
import type { PresetProject, TestVectorStep } from '../types/contracts';
import {
  makeBuzzerBugs,
  makeRgbCubeBugs,
  makeSequenceDetectorBugs,
  makeSnakeBugs,
  makeStopwatchBugs,
  makeTetrisBugs,
} from './bugClinic';
import { MOCK_PRESETS } from './mockPresets';

// ============================================================
// 1011 序列检测器
// ============================================================

export const SEQUENCE_DETECTOR_CODE = `module top (
    input         clk,
    input         rst_n,
    input  [3:0]  key,
    input  [7:0]  sw,
    output [7:0]  led,
    output [2:0]  traffic,
    output [15:0] seg
);
    localparam S0 = 2'd0;
    localparam S1 = 2'd1;
    localparam S2 = 2'd2;
    localparam S3 = 2'd3;

    reg [1:0] state;
    reg       hit;
    wire      din;

    assign din = key[0];

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= S0;
            hit   <= 1'b0;
        end else begin
            hit <= 1'b0;
            case (state)
                S0: begin
                    if (din) state <= S1; else state <= S0;
                end
                S1: begin
                    if (din) state <= S1; else state <= S2;
                end
                S2: begin
                    if (din) state <= S3; else state <= S0;
                end
                S3: begin
                    if (din) begin
                        hit   <= 1'b1;
                        state <= S1;
                    end else begin
                        state <= S2;
                    end
                end
                default: state <= S0;
            endcase
        end
    end

    assign led = {7'd0, hit};
    assign seg = {12'd0, 2'b00, state};
    assign traffic = 3'b000;
endmodule
`;

const SEQUENCE_DETECTOR_VECTORS: TestVectorStep[] = [
  { cycle: 0, inputs: { rst_n: 0, key: 0, sw: 0 }, expect: { led: 0 }, note: '复位回到 S0，检测灯熄灭' },
  { cycle: 1, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { led: 0 }, note: '输入 1' },
  { cycle: 2, inputs: { rst_n: 1, key: 1, sw: 0 }, note: '输入 1（重叠前缀）' },
  { cycle: 3, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '输入 0' },
  { cycle: 4, inputs: { rst_n: 1, key: 1, sw: 0 }, note: '输入 1，已匹配 101' },
  { cycle: 5, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { led: 1 }, note: '输入 1，命中 1011' },
  { cycle: 6, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { led: 0 }, note: '命中只亮一拍' },
  { cycle: 7, inputs: { rst_n: 1, key: 1, sw: 0 }, note: '输入 1，重新累积' },
  { cycle: 8, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { led: 1 }, note: '重叠命中第二次 1011' },
  { cycle: 9, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { led: 0 }, note: '再次熄灭' },
];

const SEQUENCE_DETECTOR_BLUEPRINT: PresetProject['blueprint'] = {
  title: '1011 序列检测器',
  summary: '用 KEY0 作为串行数据输入，检测 1011；命中时 LED0 亮一拍，支持重叠检测。',
  behaviors: [
    '复位后状态机回到 S0',
    '每个时钟上升沿采样 key[0] 作为串行输入',
    '识别 1011 后 hit 置 1 一拍，并保留重叠前缀重新开始',
    'LED0 指示本拍是否检测成功',
    '数码管最低位显示当前状态编号',
  ],
  pinMappings: [
    { port: 'key[0]', role: '串行数据输入' },
    { port: 'led[0]', role: '序列命中指示' },
    { port: 'seg[3:0]', role: '当前状态编号' },
  ],
  mermaidFsm: `stateDiagram-v2
    [*] --> S0
    S0 --> S0: din=0
    S0 --> S1: din=1
    S1 --> S1: din=1
    S1 --> S2: din=0
    S2 --> S3: din=1
    S2 --> S0: din=0
    S3 --> S1: din=1 / 命中
    S3 --> S2: din=0`,
};

// ============================================================
// 数字秒表
// ============================================================

export const STOPWATCH_CODE = `module top (
    input         clk,
    input         rst_n,
    input  [3:0]  key,
    input  [7:0]  sw,
    output [7:0]  led,
    output [2:0]  traffic,
    output [15:0] seg
);
    reg [3:0] d0;
    reg [3:0] d1;
    reg [3:0] d2;
    reg [3:0] d3;
    reg       running;
    reg       key0_d;
    reg       key1_d;

    wire start_press;
    wire reset_press;
    assign start_press = key[0] & ~key0_d;
    assign reset_press = key[1] & ~key1_d;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            d0      <= 4'd0;
            d1      <= 4'd0;
            d2      <= 4'd0;
            d3      <= 4'd0;
            running <= 1'b0;
            key0_d  <= 1'b0;
            key1_d  <= 1'b0;
        end else begin
            key0_d <= key[0];
            key1_d <= key[1];
            if (reset_press) begin
                d0 <= 4'd0;
                d1 <= 4'd0;
                d2 <= 4'd0;
                d3 <= 4'd0;
            end else if (start_press) begin
                running <= ~running;
            end else if (running) begin
                if (d0 == 4'd9) begin
                    d0 <= 4'd0;
                    if (d1 == 4'd9) begin
                        d1 <= 4'd0;
                        if (d2 == 4'd9) begin
                            d2 <= 4'd0;
                            if (d3 == 4'd9) d3 <= 4'd0; else d3 <= d3 + 4'd1;
                        end else d2 <= d2 + 4'd1;
                    end else d1 <= d1 + 4'd1;
                end else d0 <= d0 + 4'd1;
            end
        end
    end

    assign seg = {d3, d2, d1, d0};
    assign led = {7'd0, running};
    assign traffic = 3'b000;
endmodule
`;

const STOPWATCH_VECTORS: TestVectorStep[] = [
  { cycle: 0, inputs: { rst_n: 0, key: 0, sw: 0 }, expect: { led: 0, seg: 0 }, note: '复位后清零并暂停' },
  { cycle: 1, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { led: 0, seg: 0 }, note: '释放复位仍暂停' },
  { cycle: 2, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { led: 1, seg: 0 }, note: 'KEY0 启动计时' },
  { cycle: 3, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { seg: 1 }, note: '运行一拍，个位为 1' },
  { cycle: 4, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 5, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 6, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 7, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 8, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 9, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 10, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '继续计时' },
  { cycle: 11, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { seg: 0x0009 }, note: '个位计到 9' },
  { cycle: 12, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { seg: 0x0010 }, note: '进位后显示 0010' },
  { cycle: 13, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { led: 0, seg: 0x0010 }, note: 'KEY0 暂停，显示保持' },
  { cycle: 14, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { led: 0, seg: 0x0010 }, note: '暂停期间不再计时' },
  { cycle: 15, inputs: { rst_n: 1, key: 2, sw: 0 }, expect: { seg: 0 }, note: 'KEY1 清零' },
  { cycle: 16, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { seg: 0 }, note: '清零后保持暂停' },
];

const STOPWATCH_BLUEPRINT: PresetProject['blueprint'] = {
  title: '4 位 BCD 数字秒表',
  summary: 'KEY0 启停计时，KEY1 清零；数码管以 BCD 形式显示 0000 到 9999。',
  behaviors: [
    '复位后显示 0000 且暂停',
    'KEY0 上升沿切换运行/暂停',
    'KEY1 上升沿把四位 BCD 清零',
    '运行时每拍个位加一，9 后归零并向高位进位',
    'LED0 指示当前是否在计时',
  ],
  pinMappings: [
    { port: 'key[0]', role: '启动/暂停' },
    { port: 'key[1]', role: '清零' },
    { port: 'seg', role: '四位计时显示' },
    { port: 'led[0]', role: '运行指示' },
  ],
  mermaidFsm: `stateDiagram-v2
    [*] --> PAUSED
    PAUSED --> RUNNING: KEY0
    RUNNING --> PAUSED: KEY0
    RUNNING --> RUNNING: KEY1 清零
    PAUSED --> PAUSED: KEY1 清零`,
};

// ============================================================
// 四人抢答器
// ============================================================

export const BUZZER_CODE = `module top (
    input         clk,
    input         rst_n,
    input  [3:0]  key,
    input  [7:0]  sw,
    output [7:0]  led,
    output [2:0]  traffic,
    output [15:0] seg
);
    reg       locked;
    reg [1:0] winner;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            locked <= 1'b0;
            winner <= 2'd0;
        end else if (!locked) begin
            if (key[3]) begin
                winner <= 2'd3;
                locked <= 1'b1;
            end else if (key[2]) begin
                winner <= 2'd2;
                locked <= 1'b1;
            end else if (key[1]) begin
                winner <= 2'd1;
                locked <= 1'b1;
            end else if (key[0]) begin
                winner <= 2'd0;
                locked <= 1'b1;
            end
        end
    end

    assign led = ~locked ? 8'd0 :
                 (winner == 2'd0) ? 8'h01 :
                 (winner == 2'd1) ? 8'h02 :
                 (winner == 2'd2) ? 8'h04 : 8'h08;
    assign seg = {12'd0, 2'b00, winner};
    assign traffic = 3'b000;
endmodule
`;

const BUZZER_VECTORS: TestVectorStep[] = [
  { cycle: 0, inputs: { rst_n: 0, key: 0, sw: 0 }, expect: { led: 0 }, note: '复位后没有获胜者' },
  { cycle: 1, inputs: { rst_n: 1, key: 2, sw: 0 }, expect: { led: 0x02 }, note: '选手 1 先按下，LED1 点亮' },
  { cycle: 2, inputs: { rst_n: 1, key: 8, sw: 0 }, expect: { led: 0x02 }, note: '选手 3 后按无效' },
  { cycle: 3, inputs: { rst_n: 1, key: 5, sw: 0 }, expect: { led: 0x02 }, note: '锁存后同时按多位也无效' },
  { cycle: 4, inputs: { rst_n: 0, key: 0, sw: 0 }, expect: { led: 0 }, note: '复位重新开始' },
  { cycle: 5, inputs: { rst_n: 1, key: 12, sw: 0 }, expect: { led: 0x08 }, note: '同时按下选手 2 和 3，编号大的获胜' },
  { cycle: 6, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { led: 0x08 }, note: '保持锁定' },
  { cycle: 7, inputs: { rst_n: 0, key: 0, sw: 0 }, expect: { led: 0 }, note: '再次复位' },
  { cycle: 8, inputs: { rst_n: 1, key: 5, sw: 0 }, expect: { led: 0x04 }, note: '同时按下选手 0 和 2，编号大的获胜' },
];

const BUZZER_BLUEPRINT: PresetProject['blueprint'] = {
  title: '四人抢答器',
  summary: '四位选手各按一个按键，先按下者被锁存并由 LED0-3 指示，复位后重新开始。',
  behaviors: [
    '复位后清除锁存与获胜者',
    '未锁存时检测 KEY0-KEY3，任意按键按下立即锁存',
    '同时按下多个按键时编号大的选手优先',
    '锁存后忽略后续按键，直到复位',
    'LED0-3 点亮对应获胜者，数码管显示获胜者编号',
  ],
  pinMappings: [
    { port: 'key[3:0]', role: '四位选手抢答按键' },
    { port: 'led[3:0]', role: '获胜指示灯' },
    { port: 'seg[3:0]', role: '获胜者编号' },
    { port: 'rst_n', role: '复位重新开始' },
  ],
  mermaidFsm: `stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOCKED: 任一选手按下
    LOCKED --> IDLE: rst_n=0`,
};

// ============================================================

// ============================================================
// 16×8 256 色 OLED 贪吃蛇（V3 屏幕 + 方向键游戏案例）
// ============================================================

export const SNAKE_CODE = `module top (
    input            clk,
    input            rst_n,
    input      [3:0] key,
    input      [7:0] sw,
    output     [7:0] led,
    output     [2:0] traffic,
    output    [15:0] seg,
    output     [3:0] tone,
    output reg [3:0] screen_x,
    output reg [2:0] screen_y,
    output reg [7:0] screen_data,
    output reg [1:0] screen_cmd,
    output     [7:0] screen_color
);
    localparam ST_INIT = 2'd0;
    localparam ST_PLAY = 2'd1;
    localparam ST_OVER = 2'd2;

    localparam DIR_UP    = 2'd0;
    localparam DIR_DOWN  = 2'd1;
    localparam DIR_LEFT  = 2'd2;
    localparam DIR_RIGHT = 2'd3;

    localparam TILE_EMPTY = 8'h00;
    localparam TILE_HEAD  = 8'h83;
    localparam TILE_BODY  = 8'h84;
    localparam TILE_FOOD  = 8'h85;

    reg [1:0] state;
    reg [3:0] sub;
    reg [1:0] dir;
    reg [1:0] next_dir;
    reg [5:0] slen;
    reg [3:0] sx [0:31];
    reg [2:0] sy [0:31];
    reg [3:0] food_x;
    reg [2:0] food_y;
    reg [3:0] prev_hx;
    reg [2:0] prev_hy;
    reg [3:0] tail_x;
    reg [2:0] tail_y;
    reg [3:0] score_lo;
    reg [3:0] score_hi;
    reg [7:0] lfsr;
    reg       ate_r;
    reg [3:0] tone_r;

    reg [1:0] eff_dir;
    reg [3:0] cand_x;
    reg [2:0] cand_y;
    reg       hit_wall;
    reg       will_eat;
    reg       hit_self;
    reg       food_busy;

    wire [4:0] tail_idx;
    assign tail_idx = (slen > 6'd31) ? 5'd31 : (slen[4:0] - 5'd1);

    integer j;
    integer k;

    always @(*) begin
        eff_dir = next_dir;
        if (key[0] && dir != DIR_DOWN)       eff_dir = DIR_UP;
        else if (key[1] && dir != DIR_UP)    eff_dir = DIR_DOWN;
        else if (key[2] && dir != DIR_RIGHT) eff_dir = DIR_LEFT;
        else if (key[3] && dir != DIR_LEFT)  eff_dir = DIR_RIGHT;

        cand_x   = sx[0];
        cand_y   = sy[0];
        hit_wall = 1'b0;
        case (eff_dir)
            DIR_UP: begin
                if (sy[0] == 3'd0) hit_wall = 1'b1;
                else cand_y = sy[0] - 3'd1;
            end
            DIR_DOWN: begin
                if (sy[0] == 3'd7) hit_wall = 1'b1;
                else cand_y = sy[0] + 3'd1;
            end
            DIR_LEFT: begin
                if (sx[0] == 4'd0) hit_wall = 1'b1;
                else cand_x = sx[0] - 4'd1;
            end
            default: begin
                if (sx[0] == 4'd15) hit_wall = 1'b1;
                else cand_x = sx[0] + 4'd1;
            end
        endcase

        will_eat = (!hit_wall) && (cand_x == food_x) && (cand_y == food_y);

        hit_self = 1'b0;
        for (j = 0; j < 32; j = j + 1) begin
            if ((j < slen) && (will_eat || ((j + 1) < slen))) begin
                if ((sx[j] == cand_x) && (sy[j] == cand_y)) begin
                    hit_self = 1'b1;
                end
            end
        end

        food_busy = 1'b0;
        for (j = 0; j < 32; j = j + 1) begin
            if ((j < slen) && (sx[j] == food_x) && (sy[j] == food_y)) begin
                food_busy = 1'b1;
            end
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state       <= ST_INIT;
            sub         <= 4'd0;
            dir         <= DIR_RIGHT;
            next_dir    <= DIR_RIGHT;
            slen        <= 6'd3;
            sx[0]       <= 4'd6; sy[0] <= 3'd3;
            sx[1]       <= 4'd5; sy[1] <= 3'd3;
            sx[2]       <= 4'd4; sy[2] <= 3'd3;
            for (k = 3; k < 32; k = k + 1) begin
                sx[k] <= 4'd0;
                sy[k] <= 3'd0;
            end
            food_x      <= 4'd10;
            food_y      <= 3'd3;
            prev_hx     <= 4'd6;
            prev_hy     <= 3'd3;
            tail_x      <= 4'd4;
            tail_y      <= 3'd3;
            score_lo    <= 4'd0;
            score_hi    <= 4'd0;
            lfsr        <= 8'h5A;
            ate_r       <= 1'b0;
            tone_r      <= 4'd0;
            screen_x    <= 4'd0;
            screen_y    <= 3'd0;
            screen_data <= TILE_EMPTY;
            screen_cmd  <= 2'b10;
        end else begin
            lfsr       <= {lfsr[6:0], lfsr[7] ^ lfsr[5] ^ lfsr[4] ^ lfsr[3]};
            tone_r     <= 4'd0;
            screen_cmd <= 2'b00;

            case (state)
                ST_INIT: begin
                    case (sub)
                        4'd0: begin
                            screen_x    <= food_x;
                            screen_y    <= food_y;
                            screen_data <= TILE_FOOD;
                            screen_cmd  <= 2'b01;
                            sub         <= 4'd1;
                        end
                        4'd1: begin
                            screen_x    <= sx[2];
                            screen_y    <= sy[2];
                            screen_data <= TILE_BODY;
                            screen_cmd  <= 2'b01;
                            sub         <= 4'd2;
                        end
                        4'd2: begin
                            screen_x    <= sx[1];
                            screen_y    <= sy[1];
                            screen_data <= TILE_BODY;
                            screen_cmd  <= 2'b01;
                            sub         <= 4'd3;
                        end
                        default: begin
                            screen_x    <= sx[0];
                            screen_y    <= sy[0];
                            screen_data <= TILE_HEAD;
                            screen_cmd  <= 2'b01;
                            state       <= ST_PLAY;
                            sub         <= 4'd0;
                        end
                    endcase
                end

                ST_PLAY: begin
                    if (key[0] && dir != DIR_DOWN)       next_dir <= DIR_UP;
                    else if (key[1] && dir != DIR_UP)    next_dir <= DIR_DOWN;
                    else if (key[2] && dir != DIR_RIGHT) next_dir <= DIR_LEFT;
                    else if (key[3] && dir != DIR_LEFT)  next_dir <= DIR_RIGHT;

                    case (sub)
                        4'd0: begin
                            if (hit_wall || hit_self) begin
                                state      <= ST_OVER;
                                sub        <= 4'd0;
                                tone_r     <= 4'd15;
                                screen_cmd <= 2'b10;
                            end else begin
                                dir      <= eff_dir;
                                next_dir <= eff_dir;
                                prev_hx  <= sx[0];
                                prev_hy  <= sy[0];
                                tail_x   <= sx[tail_idx];
                                tail_y   <= sy[tail_idx];

                                for (k = 31; k > 0; k = k - 1) begin
                                    sx[k] <= sx[k - 1];
                                    sy[k] <= sy[k - 1];
                                end
                                sx[0] <= cand_x;
                                sy[0] <= cand_y;

                                screen_x    <= cand_x;
                                screen_y    <= cand_y;
                                screen_data <= TILE_HEAD;
                                screen_cmd  <= 2'b01;

                                if (will_eat) begin
                                    ate_r  <= 1'b1;
                                    tone_r <= 4'd14;
                                    if (slen < 6'd32) slen <= slen + 6'd1;
                                    if (score_lo == 4'd9) begin
                                        score_lo <= 4'd0;
                                        if (score_hi < 4'd9) score_hi <= score_hi + 4'd1;
                                    end else begin
                                        score_lo <= score_lo + 4'd1;
                                    end
                                    food_x <= food_x + 4'd5 + {2'd0, lfsr[1:0]};
                                    food_y <= food_y + 3'd3 + {2'd0, lfsr[2]};
                                end else begin
                                    ate_r <= 1'b0;
                                    if (eff_dir != dir) tone_r <= 4'd13;
                                end
                                sub <= 4'd1;
                            end
                        end

                        4'd1: begin
                            screen_x    <= prev_hx;
                            screen_y    <= prev_hy;
                            screen_data <= TILE_BODY;
                            screen_cmd  <= 2'b01;
                            sub         <= 4'd2;
                        end

                        4'd2: begin
                            if (ate_r) begin
                                if (food_busy) begin
                                    food_x <= food_x + 4'd3;
                                    food_y <= food_y + 3'd1;
                                end else begin
                                    screen_x    <= food_x;
                                    screen_y    <= food_y;
                                    screen_data <= TILE_FOOD;
                                    screen_cmd  <= 2'b01;
                                    ate_r       <= 1'b0;
                                    sub         <= 4'd3;
                                end
                            end else begin
                                screen_x    <= tail_x;
                                screen_y    <= tail_y;
                                screen_data <= TILE_EMPTY;
                                screen_cmd  <= 2'b01;
                                sub         <= 4'd3;
                            end
                        end

                        default: begin
                            screen_x    <= food_x;
                            screen_y    <= food_y;
                            screen_data <= TILE_FOOD;
                            screen_cmd  <= 2'b01;
                            sub         <= 4'd0;
                        end
                    endcase
                end

                default: begin
                    case (sub)
                        4'd0:  begin screen_x <= 4'd3;  screen_y <= 3'd3; screen_data <= 8'h47; screen_cmd <= 2'b01; sub <= 4'd1;  end
                        4'd1:  begin screen_x <= 4'd4;  screen_y <= 3'd3; screen_data <= 8'h41; screen_cmd <= 2'b01; sub <= 4'd2;  end
                        4'd2:  begin screen_x <= 4'd5;  screen_y <= 3'd3; screen_data <= 8'h4D; screen_cmd <= 2'b01; sub <= 4'd3;  end
                        4'd3:  begin screen_x <= 4'd6;  screen_y <= 3'd3; screen_data <= 8'h45; screen_cmd <= 2'b01; sub <= 4'd4;  end
                        4'd4:  begin screen_x <= 4'd7;  screen_y <= 3'd3; screen_data <= 8'h20; screen_cmd <= 2'b01; sub <= 4'd5;  end
                        4'd5:  begin screen_x <= 4'd8;  screen_y <= 3'd3; screen_data <= 8'h4F; screen_cmd <= 2'b01; sub <= 4'd6;  end
                        4'd6:  begin screen_x <= 4'd9;  screen_y <= 3'd3; screen_data <= 8'h56; screen_cmd <= 2'b01; sub <= 4'd7;  end
                        4'd7:  begin screen_x <= 4'd10; screen_y <= 3'd3; screen_data <= 8'h45; screen_cmd <= 2'b01; sub <= 4'd8;  end
                        4'd8:  begin screen_x <= 4'd11; screen_y <= 3'd3; screen_data <= 8'h52; screen_cmd <= 2'b01; sub <= 4'd9;  end
                        4'd9:  begin screen_x <= 4'd5;  screen_y <= 3'd5; screen_data <= 8'h52; screen_cmd <= 2'b01; sub <= 4'd10; end
                        4'd10: begin screen_x <= 4'd6;  screen_y <= 3'd5; screen_data <= 8'h3A; screen_cmd <= 2'b01; sub <= 4'd11; end
                        4'd11: begin screen_x <= 4'd7;  screen_y <= 3'd5; screen_data <= 8'h52; screen_cmd <= 2'b01; sub <= 4'd12; end
                        4'd12: begin screen_x <= 4'd8;  screen_y <= 3'd5; screen_data <= 8'h53; screen_cmd <= 2'b01; sub <= 4'd13; end
                        4'd13: begin screen_x <= 4'd9;  screen_y <= 3'd5; screen_data <= 8'h54; screen_cmd <= 2'b01; sub <= 4'd14; end
                        default: begin screen_cmd <= 2'b00; end
                    endcase
                end
            endcase
        end
    end

    assign led     = {state == ST_OVER, 5'd0, ate_r, state == ST_PLAY};
    assign traffic = (state == ST_OVER) ? 3'b100 : ((state == ST_PLAY) ? 3'b001 : 3'b010);
    assign seg     = {8'd0, score_hi, score_lo};
    assign tone    = tone_r;

    // 256 色调色板：蛇头绿(8) / 蛇身青(3) / 食物红(1) / ASCII 文字琥珀(2) / 其余默认色(0)
    assign screen_color = (screen_data == TILE_HEAD) ? 8'd8 :
                          (screen_data == TILE_BODY) ? 8'd3 :
                          (screen_data == TILE_FOOD) ? 8'd1 :
                          ((screen_data >= 8'h20) && (screen_data <= 8'h7E)) ? 8'd2 : 8'd0;
endmodule
`;

const SNAKE_VECTORS: TestVectorStep[] = [
  {
    cycle: 0,
    inputs: { rst_n: 0, key: 0, sw: 0 },
    expect: { led: 0, seg: 0 },
    expectScreen: [{ x: 6, y: 3, code: 0x00 }],
    note: '复位清屏并初始化蛇身与食物位置',
  },
  { cycle: 1, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 10, y: 3, code: 0x85 }], note: '绘制初始食物 (10,3)' },
  { cycle: 2, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 4, y: 3, code: 0x84 }], note: '绘制初始蛇尾 (4,3)' },
  { cycle: 3, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 5, y: 3, code: 0x84 }], note: '绘制初始蛇身 (5,3)' },
  {
    cycle: 4,
    inputs: { rst_n: 1, key: 0, sw: 0 },
    expect: { led: 1, seg: 0 },
    expectScreen: [
      { x: 6, y: 3, code: 0x83 },
      { x: 5, y: 3, code: 0x84 },
      { x: 4, y: 3, code: 0x84 },
      { x: 10, y: 3, code: 0x85 },
    ],
    note: '绘制初始蛇头 (6,3)，进入运行态',
  },
  { cycle: 5, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 7, y: 3, code: 0x83 }], note: '向右前进一步，蛇头抵达 (7,3)' },
  { cycle: 6, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 6, y: 3, code: 0x84 }], note: '原蛇头 (6,3) 转为蛇身' },
  { cycle: 7, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 4, y: 3, code: 0x00 }], note: '擦除旧蛇尾 (4,3)' },
  { cycle: 8, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '完成第 1 步移动节拍' },
  { cycle: 9, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '第 2 步：蛇头抵达 (8,3)' },
  { cycle: 10, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '更新蛇身' },
  { cycle: 11, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '擦除旧尾 (5,3)' },
  { cycle: 12, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '完成第 2 步' },
  { cycle: 13, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '第 3 步：蛇头抵达 (9,3)' },
  { cycle: 14, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '更新蛇身' },
  { cycle: 15, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '擦除旧尾 (6,3)' },
  { cycle: 16, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '完成第 3 步' },
  {
    cycle: 17,
    inputs: { rst_n: 1, key: 0, sw: 0 },
    expect: { seg: 1 },
    expectTone: 14,
    expectScreen: [{ x: 10, y: 3, code: 0x83 }],
    note: '蛇头吃到食物 (10,3)：得分 +1 并触发得分音',
  },
  { cycle: 18, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 9, y: 3, code: 0x84 }], note: '蛇身增长保留旧尾 (7,3)' },
  { cycle: 19, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 7, y: 3, code: 0x84 }], note: '刷新新食物并保持 4 节蛇身' },
  { cycle: 20, inputs: { rst_n: 1, key: 2, sw: 0 }, note: '按下 KEY1 (S / ↓) 锁存向下转向' },
  {
    cycle: 21,
    inputs: { rst_n: 1, key: 0, sw: 0 },
    expectScreen: [{ x: 10, y: 4, code: 0x83 }],
    note: '按方向键成功向下拐弯至 (10,4)',
  },
  { cycle: 22, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 10, y: 3, code: 0x84 }], note: '拐点转为蛇身' },
  { cycle: 23, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 7, y: 3, code: 0x00 }], note: '擦除新尾 (7,3)' },
];

const SNAKE_BLUEPRINT: PresetProject['blueprint'] = {
  title: '16×8 彩色 OLED 贪吃蛇',
  summary: '在 16×8 256 色 OLED 屏上运行完整贪吃蛇：KEY0–KEY3（WASD / 方向键）控制上下左右，蛇头绿、蛇身青、食物红，吃食物增长并计分。',
  behaviors: [
    '复位后清屏并在 (6,3) 初始化 3 节蛇身，(10,3) 放置红色食物，默认向右移动',
    '每拍持续采样 KEY0(上/W)、KEY1(下/S)、KEY2(左/A)、KEY3(右/D) 锁存下一方向，禁止 180° 直接掉头',
    '采用增量显存绘制与 screen_color[7:0] 着色（蛇头绿、蛇身青、食物红、文字琥珀），零闪烁流畅运行',
    '蛇头到达食物坐标时长度加 1、数码管 BCD 得分递增并由 LFSR 避开蛇身生成新食物',
    '撞到屏幕边界或自身时清屏显示 GAME OVER，按 RST (R) 立即重开一局',
  ],
  pinMappings: [
    { port: 'key[0]', role: '向上转向（W / ↑）' },
    { port: 'key[1]', role: '向下转向（S / ↓）' },
    { port: 'key[2]', role: '向左转向（A / ←）' },
    { port: 'key[3]', role: '向右转向（D / →）' },
    { port: 'rst_n', role: '硬件复位 / 重新开始（R）' },
    { port: 'screen_x/y/data/cmd/color', role: '16×8 256 色 OLED 显存写入、着色与清屏端口' },
    { port: 'seg[7:0]', role: '2 位 BCD 当前得分' },
    { port: 'tone[3:0]', role: '转向、吃食物与撞墙提示音' },
  ],
  mermaidFsm: `stateDiagram-v2
    [*] --> ST_INIT
    ST_INIT --> ST_PLAY: 初始画面绘制完成
    ST_PLAY --> ST_PLAY: 移动 / 转向 / 吃食物
    ST_PLAY --> ST_OVER: 撞墙或撞到自身
    ST_OVER --> ST_INIT: rst_n=0 复位重开`,
};

// ============================================================
// 16×8 256 色 OLED 俄罗斯方块（7 种经典彩色方块 + 旋转踢墙 + 满行消除 + NEXT 预览）
// ============================================================

export const TETRIS_CODE = `module top (
    input            clk,
    input            rst_n,
    input      [3:0] key,
    input      [7:0] sw,
    output     [7:0] led,
    output     [2:0] traffic,
    output    [15:0] seg,
    output     [3:0] tone,
    output reg [3:0] screen_x,
    output reg [2:0] screen_y,
    output reg [7:0] screen_data,
    output reg [1:0] screen_cmd,
    output reg [7:0] screen_color
);
    localparam ST_PLAY  = 2'd0;
    localparam ST_CLEAR = 2'd1;
    localparam ST_OVER  = 2'd2;

    localparam TILE_WALL_L = 8'h94; // 左边框：右半实心竖条，紧贴井区
    localparam TILE_WALL_R = 8'h93; // 右边框：左半实心竖条，紧贴井区
    localparam COL_WALL    = 8'd240; // 深灰边框

    reg [1:0]  state;
    reg [2:0]  board [0:15][0:9];    // 10x16 标准宽度井区（每块 4x4 实心像素）：0=空，1..7=方块色号
    reg [15:0] shown [0:7][0:15];    // 屏幕当前已绘制缓存 {color, data}
    reg [2:0]  piece;                // 当前方块 0..6 (I/O/T/L/J/S/Z)
    reg [2:0]  next_piece;           // 下一个预览方块 0..6
    reg [1:0]  rot;                  // 旋转角度 0..3
    reg [3:0]  px;                   // 井区 X 坐标 0..9
    reg [3:0]  py;                   // 井区 Y 坐标 0..15
    reg [8:0]  grav_cnt;             // 1 kHz 重力下落分频计数
    reg [5:0]  drop_cnt;             // 软降长按连发分频计数
    reg [7:0]  das_cnt;              // 左右平移长按连发（DAS）计数
    reg [3:0]  prev_key;             // 按键边沿检测
    reg [7:0]  lfsr;                 // 伪随机方块序列
    reg [3:0]  line_lo;
    reg [3:0]  line_hi;
    reg [3:0]  score_lo;
    reg [3:0]  score_hi;
    reg [3:0]  tone_r;
    reg        well_dirty;
    reg        hud_dirty;

    integer iy, ix;

    // NEXT 预览方块 256 色配色：I青 O黄 T紫 L橙 J蓝 S绿 Z红
    reg [7:0] next_col;
    reg [3:0] prev_l_mask;
    reg [3:0] prev_r_mask;
    always @(*) begin
        case (next_piece)
            3'd0: begin next_col = 8'd51;  prev_l_mask = 4'b1100; prev_r_mask = 4'b1100; end
            3'd1: begin next_col = 8'd226; prev_l_mask = 4'b0101; prev_r_mask = 4'b1010; end
            3'd2: begin next_col = 8'd129; prev_l_mask = 4'b0111; prev_r_mask = 4'b0010; end
            3'd3: begin next_col = 8'd208; prev_l_mask = 4'b0011; prev_r_mask = 4'b1010; end
            3'd4: begin next_col = 8'd33;  prev_l_mask = 4'b1011; prev_r_mask = 4'b0010; end
            3'd5: begin next_col = 8'd46;  prev_l_mask = 4'b0111; prev_r_mask = 4'b1000; end
            default: begin next_col = 8'd196; prev_l_mask = 4'b1101; prev_r_mask = 4'b0010; end
        endcase
    end

    // 当前方块 (piece, rot) 归一化 4 格相对偏移（min dx=0, min dy=0）
    reg [3:0] dx0, dy0, dx1, dy1, dx2, dy2, dx3, dy3;
    always @(*) begin
        dx0 = 4'd0; dy0 = 4'd0; dx1 = 4'd1; dy1 = 4'd0;
        dx2 = 4'd0; dy2 = 4'd1; dx3 = 4'd1; dy3 = 4'd1;
        case ({piece, rot})
            // I-piece
            5'b000_00, 5'b000_10: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=2; dy2=0; dx3=3; dy3=0; end
            5'b000_01, 5'b000_11: begin dx0=0; dy0=0; dx1=0; dy1=1; dx2=0; dy2=2; dx3=0; dy3=3; end
            // O-piece
            5'b001_00, 5'b001_01, 5'b001_10, 5'b001_11: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=0; dy2=1; dx3=1; dy3=1; end
            // T-piece
            5'b010_00: begin dx0=1; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=2; dy3=1; end
            5'b010_01: begin dx0=0; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=0; dy3=2; end
            5'b010_10: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=2; dy2=0; dx3=1; dy3=1; end
            5'b010_11: begin dx0=1; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=1; dy3=2; end
            // L-piece
            5'b011_00: begin dx0=2; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=2; dy3=1; end
            5'b011_01: begin dx0=0; dy0=0; dx1=0; dy1=1; dx2=0; dy2=2; dx3=1; dy3=2; end
            5'b011_10: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=2; dy2=0; dx3=0; dy3=1; end
            5'b011_11: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=1; dy2=1; dx3=1; dy3=2; end
            // J-piece
            5'b100_00: begin dx0=0; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=2; dy3=1; end
            5'b100_01: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=0; dy2=1; dx3=0; dy3=2; end
            5'b100_10: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=2; dy2=0; dx3=2; dy3=1; end
            5'b100_11: begin dx0=1; dy0=0; dx1=1; dy1=1; dx2=0; dy2=2; dx3=1; dy3=2; end
            // S-piece
            5'b101_00, 5'b101_10: begin dx0=1; dy0=0; dx1=2; dy1=0; dx2=0; dy2=1; dx3=1; dy3=1; end
            5'b101_01, 5'b101_11: begin dx0=0; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=1; dy3=2; end
            // Z-piece
            5'b110_00, 5'b110_10: begin dx0=0; dy0=0; dx1=1; dy1=0; dx2=1; dy2=1; dx3=2; dy3=1; end
            default:              begin dx0=1; dy0=0; dx1=0; dy1=1; dx2=1; dy2=1; dx3=0; dy3=2; end
        endcase
    end

    // 下一个方块 (next_piece, rot=0) 的 4 格偏移（用于新块出生碰撞检测）
    reg [3:0] ndx0, ndy0, ndx1, ndy1, ndx2, ndy2, ndx3, ndy3;
    always @(*) begin
        case (next_piece)
            3'd0: begin ndx0=0; ndy0=0; ndx1=1; ndy1=0; ndx2=2; ndy2=0; ndx3=3; ndy3=0; end
            3'd1: begin ndx0=0; ndy0=0; ndx1=1; ndy1=0; ndx2=0; ndy2=1; ndx3=1; ndy3=1; end
            3'd2: begin ndx0=1; ndy0=0; ndx1=0; ndy1=1; ndx2=1; ndy2=1; ndx3=2; ndy3=1; end
            3'd3: begin ndx0=2; ndy0=0; ndx1=0; ndy1=1; ndx2=1; ndy2=1; ndx3=2; ndy3=1; end
            3'd4: begin ndx0=0; ndy0=0; ndx1=0; ndy1=1; ndx2=1; ndy2=1; ndx3=2; ndy3=1; end
            3'd5: begin ndx0=1; ndy0=0; ndx1=2; ndy1=0; ndx2=0; ndy2=1; ndx3=1; ndy3=1; end
            default: begin ndx0=0; ndy0=0; ndx1=1; ndy1=0; ndx2=1; ndy2=1; ndx3=2; ndy3=1; end
        endcase
    end

    // 按键上升沿、长按连发与 1 kHz 重力触发
    wire das_fire = (das_cnt >= 8'd160);
    wire key_rot  = key[0] && !prev_key[0];
    wire key_drop = key[1] && (!prev_key[1] || (drop_cnt >= 6'd50));
    wire key_l    = key[2] && (!prev_key[2] || das_fire);
    wire key_r    = key[3] && (!prev_key[3] || das_fire);
    wire grav_due = (grav_cnt >= (sw[0] ? 9'd140 : 9'd360));

    // 候选动作目标坐标与旋转后 4 格偏移（5 位防止 15+1 溢出回绕）
    reg [1:0] act_mode; // 0=无/下落 1=左移 2=右移 3=旋转
    reg [4:0] cand_px;
    reg [4:0] cand_py;
    reg [1:0] cand_rot;
    always @(*) begin
        act_mode = 2'd0;
        cand_px  = {1'b0, px};
        cand_py  = {1'b0, py};
        cand_rot = rot;
        if (state == ST_PLAY) begin
            if (key_l) begin
                act_mode = 2'd1;
                cand_px  = (px > 4'd0) ? ({1'b0, px} - 5'd1) : 5'd10;
            end else if (key_r) begin
                act_mode = 2'd2;
                cand_px  = {1'b0, px} + 5'd1;
            end else if (key_rot) begin
                act_mode = 2'd3;
                cand_rot = rot + 2'd1;
            end else if (key_drop || grav_due) begin
                act_mode = 2'd0;
                cand_py  = {1'b0, py} + 5'd1;
            end
        end
    end
    wire want_down = (state == ST_PLAY) && !key_l && !key_r && !key_rot && (key_drop || grav_due);

    // 候选旋转 (piece, cand_rot) 4 格偏移
    reg [3:0] tdx0, tdy0, tdx1, tdy1, tdx2, tdy2, tdx3, tdy3;
    always @(*) begin
        tdx0 = 4'd0; tdy0 = 4'd0; tdx1 = 4'd1; tdy1 = 4'd0;
        tdx2 = 4'd0; tdy2 = 4'd1; tdx3 = 4'd1; tdy3 = 4'd1;
        case ({piece, cand_rot})
            5'b000_00, 5'b000_10: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=2; tdy2=0; tdx3=3; tdy3=0; end
            5'b000_01, 5'b000_11: begin tdx0=0; tdy0=0; tdx1=0; tdy1=1; tdx2=0; tdy2=2; tdx3=0; tdy3=3; end
            5'b001_00, 5'b001_01, 5'b001_10, 5'b001_11: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=0; tdy2=1; tdx3=1; tdy3=1; end
            5'b010_00: begin tdx0=1; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=2; tdy3=1; end
            5'b010_01: begin tdx0=0; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=0; tdy3=2; end
            5'b010_10: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=2; tdy2=0; tdx3=1; tdy3=1; end
            5'b010_11: begin tdx0=1; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=1; tdy3=2; end
            5'b011_00: begin tdx0=2; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=2; tdy3=1; end
            5'b011_01: begin tdx0=0; tdy0=0; tdx1=0; tdy1=1; tdx2=0; tdy2=2; tdx3=1; tdy3=2; end
            5'b011_10: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=2; tdy2=0; tdx3=0; tdy3=1; end
            5'b011_11: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=1; tdy2=1; tdx3=1; tdy3=2; end
            5'b100_00: begin tdx0=0; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=2; tdy3=1; end
            5'b100_01: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=0; tdy2=1; tdx3=0; tdy3=2; end
            5'b100_10: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=2; tdy2=0; tdx3=2; tdy3=1; end
            5'b100_11: begin tdx0=1; tdy0=0; tdx1=1; tdy1=1; tdx2=0; tdy2=2; tdx3=1; tdy3=2; end
            5'b101_00, 5'b101_10: begin tdx0=1; tdy0=0; tdx1=2; tdy1=0; tdx2=0; tdy2=1; tdx3=1; tdy3=1; end
            5'b101_01, 5'b101_11: begin tdx0=0; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=1; tdy3=2; end
            5'b110_00, 5'b110_10: begin tdx0=0; tdy0=0; tdx1=1; tdy1=0; tdx2=1; tdy2=1; tdx3=2; tdy3=1; end
            default:              begin tdx0=1; tdy0=0; tdx1=0; tdy1=1; tdx2=1; tdy2=1; tdx3=0; tdy3=2; end
        endcase
    end

    // 碰撞校验（原位 + 旋转左踢 1/2/3 格，兼容 I 长条靠右墙旋转）
    wire [4:0] c0x = cand_px + {1'b0, tdx0}; wire [4:0] c0y = cand_py + {1'b0, tdy0};
    wire [4:0] c1x = cand_px + {1'b0, tdx1}; wire [4:0] c1y = cand_py + {1'b0, tdy1};
    wire [4:0] c2x = cand_px + {1'b0, tdx2}; wire [4:0] c2y = cand_py + {1'b0, tdy2};
    wire [4:0] c3x = cand_px + {1'b0, tdx3}; wire [4:0] c3y = cand_py + {1'b0, tdy3};
    wire cand_ok =
        (c0x < 5'd10) && (c0y < 5'd16) && (board[c0y[3:0]][(c0x < 5'd10) ? c0x[3:0] : 4'd0] == 3'd0) &&
        (c1x < 5'd10) && (c1y < 5'd16) && (board[c1y[3:0]][(c1x < 5'd10) ? c1x[3:0] : 4'd0] == 3'd0) &&
        (c2x < 5'd10) && (c2y < 5'd16) && (board[c2y[3:0]][(c2x < 5'd10) ? c2x[3:0] : 4'd0] == 3'd0) &&
        (c3x < 5'd10) && (c3y < 5'd16) && (board[c3y[3:0]][(c3x < 5'd10) ? c3x[3:0] : 4'd0] == 3'd0);

    wire [4:0] k1_px = (px > 4'd0) ? ({1'b0, px} - 5'd1) : 5'd10;
    wire [4:0] k10x = k1_px + {1'b0, tdx0}; wire [4:0] k11x = k1_px + {1'b0, tdx1};
    wire [4:0] k12x = k1_px + {1'b0, tdx2}; wire [4:0] k13x = k1_px + {1'b0, tdx3};
    wire kick1_ok =
        (k10x < 5'd10) && (c0y < 5'd16) && (board[c0y[3:0]][(k10x < 5'd10) ? k10x[3:0] : 4'd0] == 3'd0) &&
        (k11x < 5'd10) && (c1y < 5'd16) && (board[c1y[3:0]][(k11x < 5'd10) ? k11x[3:0] : 4'd0] == 3'd0) &&
        (k12x < 5'd10) && (c2y < 5'd16) && (board[c2y[3:0]][(k12x < 5'd10) ? k12x[3:0] : 4'd0] == 3'd0) &&
        (k13x < 5'd10) && (c3y < 5'd16) && (board[c3y[3:0]][(k13x < 5'd10) ? k13x[3:0] : 4'd0] == 3'd0);

    wire [4:0] k2_px = (px > 4'd1) ? ({1'b0, px} - 5'd2) : 5'd10;
    wire [4:0] k20x = k2_px + {1'b0, tdx0}; wire [4:0] k21x = k2_px + {1'b0, tdx1};
    wire [4:0] k22x = k2_px + {1'b0, tdx2}; wire [4:0] k23x = k2_px + {1'b0, tdx3};
    wire kick2_ok =
        (k20x < 5'd10) && (c0y < 5'd16) && (board[c0y[3:0]][(k20x < 5'd10) ? k20x[3:0] : 4'd0] == 3'd0) &&
        (k21x < 5'd10) && (c1y < 5'd16) && (board[c1y[3:0]][(k21x < 5'd10) ? k21x[3:0] : 4'd0] == 3'd0) &&
        (k22x < 5'd10) && (c2y < 5'd16) && (board[c2y[3:0]][(k22x < 5'd10) ? k22x[3:0] : 4'd0] == 3'd0) &&
        (k23x < 5'd10) && (c3y < 5'd16) && (board[c3y[3:0]][(k23x < 5'd10) ? k23x[3:0] : 4'd0] == 3'd0);

    wire [4:0] k3_px = (px > 4'd2) ? ({1'b0, px} - 5'd3) : 5'd10;
    wire [4:0] k30x = k3_px + {1'b0, tdx0}; wire [4:0] k31x = k3_px + {1'b0, tdx1};
    wire [4:0] k32x = k3_px + {1'b0, tdx2}; wire [4:0] k33x = k3_px + {1'b0, tdx3};
    wire kick3_ok =
        (k30x < 5'd10) && (c0y < 5'd16) && (board[c0y[3:0]][(k30x < 5'd10) ? k30x[3:0] : 4'd0] == 3'd0) &&
        (k31x < 5'd10) && (c1y < 5'd16) && (board[c1y[3:0]][(k31x < 5'd10) ? k31x[3:0] : 4'd0] == 3'd0) &&
        (k32x < 5'd10) && (c2y < 5'd16) && (board[c2y[3:0]][(k32x < 5'd10) ? k32x[3:0] : 4'd0] == 3'd0) &&
        (k33x < 5'd10) && (c3y < 5'd16) && (board[c3y[3:0]][(k33x < 5'd10) ? k33x[3:0] : 4'd0] == 3'd0);

    // 满行扫描（16 行自底向上找最靠下的 10 格满行）与新块出生位碰撞检测
    reg       full_found;
    reg [3:0] full_row;
    integer fy;
    always @(*) begin
        full_found = 1'b0;
        full_row   = 4'd0;
        if (state == ST_CLEAR) begin
            for (fy = 0; fy < 16; fy = fy + 1) begin
                if ((board[fy][0] != 3'd0) && (board[fy][1] != 3'd0) &&
                    (board[fy][2] != 3'd0) && (board[fy][3] != 3'd0) &&
                    (board[fy][4] != 3'd0) && (board[fy][5] != 3'd0) &&
                    (board[fy][6] != 3'd0) && (board[fy][7] != 3'd0) &&
                    (board[fy][8] != 3'd0) && (board[fy][9] != 3'd0)) begin
                    full_found = 1'b1;
                    full_row   = fy[3:0];
                end
            end
        end
    end

    wire [3:0] sx0 = 4'd3 + ndx0; wire [3:0] sx1 = 4'd3 + ndx1;
    wire [3:0] sx2 = 4'd3 + ndx2; wire [3:0] sx3 = 4'd3 + ndx3;
    wire spawn_ok =
        (board[ndy0][sx0] == 3'd0) &&
        (board[ndy1][sx1] == 3'd0) &&
        (board[ndy2][sx2] == 3'd0) &&
        (board[ndy3][sx3] == 3'd0);

    // 零闪烁 2x2 实心象限差分渲染器（5x8 屏幕格 = 10x16 井区，单块 4x4 像素全实心）
    reg        dirty_found;
    reg [3:0]  dirty_x;
    reg [2:0]  dirty_y;
    reg [7:0]  dirty_data;
    reg [7:0]  dirty_col;

    reg        act_found;
    reg [3:0]  act_x;
    reg [2:0]  act_y;
    reg [7:0]  act_data;
    reg [7:0]  act_col;

    reg        bg_found;
    reg [3:0]  bg_x;
    reg [2:0]  bg_y;
    reg [7:0]  bg_data;
    reg [7:0]  bg_col;

    reg [7:0]  want_data;
    reg [7:0]  want_col;
    reg [4:0]  bxL, bxR, byT, byB;
    reg        a_tl, a_tr, a_bl, a_br;
    reg [2:0]  b_tl, b_tr, b_bl, b_br;
    reg [2:0]  c_tl, c_tr, c_bl, c_br;
    integer    sy, sx;

    wire [2:0] active_id = piece + 3'd1;
    wire [4:0] ax0 = {1'b0, px} + {1'b0, dx0}; wire [4:0] ay0 = {1'b0, py} + {1'b0, dy0};
    wire [4:0] ax1 = {1'b0, px} + {1'b0, dx1}; wire [4:0] ay1 = {1'b0, py} + {1'b0, dy1};
    wire [4:0] ax2 = {1'b0, px} + {1'b0, dx2}; wire [4:0] ay2 = {1'b0, py} + {1'b0, dy2};
    wire [4:0] ax3 = {1'b0, px} + {1'b0, dx3}; wire [4:0] ay3 = {1'b0, py} + {1'b0, dy3};

    always @(*) begin
        dirty_found = 1'b0; dirty_x = 4'd0; dirty_y = 3'd0; dirty_data = 8'h00; dirty_col = 8'd0;
        act_found   = 1'b0; act_x   = 4'd0; act_y   = 3'd0; act_data   = 8'h00; act_col   = 8'd0;
        bg_found    = 1'b0; bg_x    = 4'd0; bg_y    = 3'd0; bg_data    = 8'h00; bg_col    = 8'd0;
        want_data   = 8'h00;
        want_col    = 8'd0;
        bxL = 5'd0; bxR = 5'd0; byT = 5'd0; byB = 5'd0;
        a_tl = 1'b0; a_tr = 1'b0; a_bl = 1'b0; a_br = 1'b0;
        b_tl = 3'd0; b_tr = 3'd0; b_bl = 3'd0; b_br = 3'd0;
        c_tl = 3'd0; c_tr = 3'd0; c_bl = 3'd0; c_br = 3'd0;

        // 单遍扫描 5x8 井区格（列 2..6，对应 10x16 小方块，每象限独立 3-bit 色号无串色）
        if (well_dirty) begin
            for (sy = 0; sy < 8; sy = sy + 1) begin
                for (sx = 0; sx < 5; sx = sx + 1) begin
                    if (!act_found) begin
                        bxL = {1'b0, sx[2:0], 1'b0};
                        bxR = {1'b0, sx[2:0], 1'b1};
                        byT = {1'b0, sy[2:0], 1'b0};
                        byB = {1'b0, sy[2:0], 1'b1};

                        a_tl = (state == ST_PLAY) && (((ax0 == bxL) && (ay0 == byT)) || ((ax1 == bxL) && (ay1 == byT)) || ((ax2 == bxL) && (ay2 == byT)) || ((ax3 == bxL) && (ay3 == byT)));
                        a_tr = (state == ST_PLAY) && (((ax0 == bxR) && (ay0 == byT)) || ((ax1 == bxR) && (ay1 == byT)) || ((ax2 == bxR) && (ay2 == byT)) || ((ax3 == bxR) && (ay3 == byT)));
                        a_bl = (state == ST_PLAY) && (((ax0 == bxL) && (ay0 == byB)) || ((ax1 == bxL) && (ay1 == byB)) || ((ax2 == bxL) && (ay2 == byB)) || ((ax3 == bxL) && (ay3 == byB)));
                        a_br = (state == ST_PLAY) && (((ax0 == bxR) && (ay0 == byB)) || ((ax1 == bxR) && (ay1 == byB)) || ((ax2 == bxR) && (ay2 == byB)) || ((ax3 == bxR) && (ay3 == byB)));

                        b_tl = board[byT[3:0]][bxL[3:0]];
                        b_tr = board[byT[3:0]][bxR[3:0]];
                        b_bl = board[byB[3:0]][bxL[3:0]];
                        b_br = board[byB[3:0]][bxR[3:0]];

                        c_tl = a_tl ? active_id : b_tl;
                        c_tr = a_tr ? active_id : b_tr;
                        c_bl = a_bl ? active_id : b_bl;
                        c_br = a_br ? active_id : b_br;

                        if ({c_tl, c_tr, c_bl, c_br} == 12'd0) begin
                            want_data = 8'h00;
                            want_col  = 8'd0;
                        end else begin
                            want_data = {4'hB, c_bl[0], c_br};
                            want_col  = {c_tl, c_tr, c_bl[2:1]};
                        end

                        if (shown[sy][sx + 2] != {want_col, want_data}) begin
                            if (a_tl || a_tr || a_bl || a_br) begin
                                act_found = 1'b1;
                                act_x     = sx[3:0] + 4'd2;
                                act_y     = sy[2:0];
                                act_data  = want_data;
                                act_col   = want_col;
                            end else if (!bg_found) begin
                                bg_found = 1'b1;
                                bg_x     = sx[3:0] + 4'd2;
                                bg_y     = sy[2:0];
                                bg_data  = want_data;
                                bg_col   = want_col;
                            end
                        end
                    end
                end
            end
        end

        if (act_found) begin
            dirty_found = 1'b1; dirty_x = act_x; dirty_y = act_y; dirty_data = act_data; dirty_col = act_col;
        end else if (bg_found) begin
            dirty_found = 1'b1; dirty_x = bg_x; dirty_y = bg_y; dirty_data = bg_data; dirty_col = bg_col;
        end

        // 边框（列 1 / 7）与右侧彩色 HUD（列 10..13，仅在初始化或 HUD 变更时扫描）
        if (!dirty_found && hud_dirty) begin
            for (sy = 0; sy < 8; sy = sy + 1) begin
                if (!dirty_found && (shown[sy][1] != {COL_WALL, TILE_WALL_L})) begin
                    dirty_found = 1'b1; dirty_x = 4'd1; dirty_y = sy[2:0]; dirty_data = TILE_WALL_L; dirty_col = COL_WALL;
                end
                if (!dirty_found && (shown[sy][7] != {COL_WALL, TILE_WALL_R})) begin
                    dirty_found = 1'b1; dirty_x = 4'd7; dirty_y = sy[2:0]; dirty_data = TILE_WALL_R; dirty_col = COL_WALL;
                end
                for (sx = 10; sx < 14; sx = sx + 1) begin
                    if (!dirty_found) begin
                        want_data = 8'h00;
                        want_col  = 8'd0;
                        if (sy == 0) begin
                            want_col = 8'd2;
                            case (sx)
                                10: want_data = 8'h4E; // N
                                11: want_data = 8'h45; // E
                                12: want_data = 8'h58; // X
                                default: want_data = 8'h54; // T
                            endcase
                        end else if (sy == 1) begin
                            if ((sx == 11) && (prev_l_mask != 4'd0)) begin
                                want_data = 8'hA0 | {4'd0, prev_l_mask};
                                want_col  = next_col;
                            end else if ((sx == 12) && (prev_r_mask != 4'd0)) begin
                                want_data = 8'hA0 | {4'd0, prev_r_mask};
                                want_col  = next_col;
                            end
                        end else if (sy == 3) begin
                            want_col = 8'd13;
                            case (sx)
                                10: want_data = 8'h4C; // L
                                11: want_data = 8'h49; // I
                                12: want_data = 8'h4E; // N
                                default: want_data = 8'h45; // E
                            endcase
                        end else if (sy == 4) begin
                            want_col = 8'd5;
                            if (sx == 11) want_data = 8'h30 + {4'd0, line_hi};
                            else if (sx == 12) want_data = 8'h30 + {4'd0, line_lo};
                        end else if (sy == 6) begin
                            if (state == ST_OVER) begin
                                want_col = 8'd1;
                                case (sx)
                                    10: want_data = 8'h4F; // O
                                    11: want_data = 8'h56; // V
                                    12: want_data = 8'h45; // E
                                    default: want_data = 8'h52; // R
                                endcase
                            end else begin
                                want_col = 8'd8;
                                case (sx)
                                    10: want_data = 8'h50; // P
                                    11: want_data = 8'h4C; // L
                                    12: want_data = 8'h41; // A
                                    default: want_data = 8'h59; // Y
                                endcase
                            end
                        end
                        if (shown[sy][sx] != {want_col, want_data}) begin
                            dirty_found = 1'b1;
                            dirty_x     = sx[3:0];
                            dirty_y     = sy[2:0];
                            dirty_data  = want_data;
                            dirty_col   = want_col;
                        end
                    end
                end
            end
        end
    end

    // 下一个伪随机方块索引（0..6，无除法）
    wire [2:0] rand_raw   = lfsr[2:0] ^ lfsr[5:3];
    wire [2:0] rand_piece = (rand_raw == 3'd7) ? {1'b0, lfsr[7:6]} : rand_raw;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state        <= ST_PLAY;
            piece        <= 3'd2; // 初始紫色 T 型方块
            next_piece   <= 3'd0; // 下一个青色 I 型长条
            rot          <= 2'd0;
            px           <= 4'd3;
            py           <= 4'd0;
            grav_cnt     <= 9'd0;
            drop_cnt     <= 6'd0;
            das_cnt      <= 8'd0;
            prev_key     <= 4'd0;
            lfsr         <= 8'hA5;
            line_lo      <= 4'd0;
            line_hi      <= 4'd0;
            score_lo     <= 4'd0;
            score_hi     <= 4'd0;
            tone_r       <= 4'd0;
            well_dirty   <= 1'b1;
            hud_dirty    <= 1'b1;
            screen_x     <= 4'd0;
            screen_y     <= 3'd0;
            screen_data  <= 8'h00;
            screen_color <= 8'd0;
            screen_cmd   <= 2'b10; // 清屏
            for (iy = 0; iy < 16; iy = iy + 1) begin
                for (ix = 0; ix < 10; ix = ix + 1)
                    board[iy][ix] <= 3'd0;
            end
            for (iy = 0; iy < 8; iy = iy + 1) begin
                for (ix = 0; ix < 16; ix = ix + 1)
                    shown[iy][ix] <= 16'd0;
            end
        end else begin
            prev_key <= key;
            lfsr     <= {lfsr[6:0], lfsr[7] ^ lfsr[5] ^ lfsr[4] ^ lfsr[3] ^ key[0] ^ key[2]};
            tone_r   <= 4'd0;

            if (!key[1] || want_down)
                drop_cnt <= 6'd0;
            else if (drop_cnt < 6'd50)
                drop_cnt <= drop_cnt + 6'd1;

            if ((!key[2] && !key[3]) || (key[2] && !prev_key[2]) || (key[3] && !prev_key[3]))
                das_cnt <= 8'd0;
            else if (das_fire)
                das_cnt <= 8'd95;
            else
                das_cnt <= das_cnt + 8'd1;

            // 每拍驱动 1 个脏格到彩色 OLED
            if (dirty_found) begin
                screen_x               <= dirty_x;
                screen_y               <= dirty_y;
                screen_data            <= dirty_data;
                screen_color           <= dirty_col;
                screen_cmd             <= 2'b01;
                shown[dirty_y][dirty_x] <= {dirty_col, dirty_data};
            end else begin
                screen_cmd <= 2'b00;
                well_dirty <= 1'b0;
                hud_dirty  <= 1'b0;
            end

            case (state)
                ST_PLAY: begin
                    if (act_mode == 2'd1) begin
                        if (cand_ok) begin
                            px         <= cand_px[3:0];
                            tone_r     <= 4'd3;
                            well_dirty <= 1'b1;
                        end
                    end else if (act_mode == 2'd2) begin
                        if (cand_ok) begin
                            px         <= cand_px[3:0];
                            tone_r     <= 4'd4;
                            well_dirty <= 1'b1;
                        end
                    end else if (act_mode == 2'd3) begin
                        if (cand_ok) begin
                            rot        <= cand_rot;
                            tone_r     <= 4'd7;
                            well_dirty <= 1'b1;
                        end else if (kick1_ok) begin
                            px         <= k1_px[3:0];
                            rot        <= cand_rot;
                            tone_r     <= 4'd7;
                            well_dirty <= 1'b1;
                        end else if (kick2_ok) begin
                            px         <= k2_px[3:0];
                            rot        <= cand_rot;
                            tone_r     <= 4'd7;
                            well_dirty <= 1'b1;
                        end else if (kick3_ok) begin
                            px         <= k3_px[3:0];
                            rot        <= cand_rot;
                            tone_r     <= 4'd7;
                            well_dirty <= 1'b1;
                        end
                    end else if (want_down) begin
                        grav_cnt   <= 9'd0;
                        well_dirty <= 1'b1;
                        if (cand_ok) begin
                            py <= cand_py[3:0];
                        end else begin
                            // 触底或碰堆叠：锁定当前 4 格到井区并检查消行（保持纯实心）
                            board[py + dy0][px + dx0] <= piece + 3'd1;
                            board[py + dy1][px + dx1] <= piece + 3'd1;
                            board[py + dy2][px + dx2] <= piece + 3'd1;
                            board[py + dy3][px + dx3] <= piece + 3'd1;
                            tone_r <= 4'd6;
                            state  <= ST_CLEAR;
                        end
                    end else if (!dirty_found) begin
                        grav_cnt <= grav_cnt + 9'd1;
                    end
                end

                ST_CLEAR: begin
                    if (full_found) begin
                        for (iy = 1; iy < 16; iy = iy + 1) begin
                            if (iy <= full_row) begin
                                for (ix = 0; ix < 10; ix = ix + 1)
                                    board[iy][ix] <= board[iy - 1][ix];
                            end
                        end
                        for (ix = 0; ix < 10; ix = ix + 1)
                            board[0][ix] <= 3'd0;
                        if (line_lo == 4'd9) begin
                            line_lo <= 4'd0;
                            line_hi <= (line_hi == 4'd9) ? 4'd9 : (line_hi + 4'd1);
                        end else begin
                            line_lo <= line_lo + 4'd1;
                        end
                        if (score_lo == 4'd9) begin
                            score_lo <= 4'd0;
                            score_hi <= (score_hi == 4'd9) ? 4'd9 : (score_hi + 4'd1);
                        end else begin
                            score_lo <= score_lo + 4'd1;
                        end
                        well_dirty <= 1'b1;
                        hud_dirty  <= 1'b1;
                        tone_r     <= 4'd14;
                    end else if (spawn_ok) begin
                        piece      <= next_piece;
                        next_piece <= rand_piece;
                        px         <= 4'd3;
                        py         <= 4'd0;
                        rot        <= 2'd0;
                        grav_cnt   <= 9'd0;
                        well_dirty <= 1'b1;
                        hud_dirty  <= 1'b1;
                        state      <= ST_PLAY;
                    end else begin
                        well_dirty <= 1'b1;
                        hud_dirty  <= 1'b1;
                        state      <= ST_OVER;
                        tone_r     <= 4'd2;
                    end
                end

                default: begin
                    // ST_OVER：保持结束画面，等待 rst_n=0 重开
                end
            endcase
        end
    end

    assign led     = {piece, 3'd0, (state == ST_OVER), (state == ST_PLAY)};
    assign traffic = (state == ST_OVER) ? 3'b100 : ((state == ST_CLEAR) ? 3'b010 : 3'b001);
    assign seg     = {score_hi, score_lo, line_hi, line_lo};
    assign tone    = tone_r;
endmodule
`;

const TETRIS_VECTORS: TestVectorStep[] = [
  {
    cycle: 0,
    inputs: { rst_n: 0, key: 0, sw: 0 },
    expect: { seg: 0, traffic: 1 },
    expectScreen: [{ x: 4, y: 0, code: 0x00 }],
    note: '复位清屏并在 10×16 井区顶部生成紫色 T 型小方块',
  },
  { cycle: 1, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 3, y: 0, code: 0xb3 }], note: '绘制 T 方块左下象限格 (3,0)' },
  { cycle: 2, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 4, y: 0, code: 0xbb }], note: '绘制 T 方块主体象限格 (4,0)，4 块成型' },
  { cycle: 3, inputs: { rst_n: 1, key: 8, sw: 0 }, expectTone: 4, note: '按下 KEY3 (D / →) 向右平移 1 列并响移动音' },
  { cycle: 4, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 4, y: 0, code: 0xbb }], note: 'T 方块右移后刷新左半格 (4,0)' },
  { cycle: 5, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 5, y: 0, code: 0xb8 }], note: 'T 方块右移后刷新右半格 (5,0)' },
  { cycle: 6, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 3, y: 0, code: 0x00 }], note: '清除原左格残留像素 (3,0)' },
  { cycle: 7, inputs: { rst_n: 1, key: 1, sw: 0 }, expectTone: 7, note: '按下 KEY0 (W / ↑) 顺时针旋转 90°' },
  { cycle: 8, inputs: { rst_n: 1, key: 0, sw: 0 }, note: '刷新旋转后的小方块像素' },
  { cycle: 9, inputs: { rst_n: 1, key: 2, sw: 0 }, note: '按下 KEY1 (S / ↓) 加速软降 1 行' },
  { cycle: 10, inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { traffic: 1 }, note: '方块继续在 10×16 井区正常下落' },
];

const TETRIS_BLUEPRINT: PresetProject['blueprint'] = {
  title: '10×16 彩色俄罗斯方块',
  summary: '在 16×8 256 色 OLED 上用 2×2 实心 4×4 像素子块构建 10×16 标准宽井区：7 种经典彩色实心方块、平移旋转踢墙与软降、满行消除、NEXT 彩色预览与数码管计分。',
  behaviors: [
    '采用 4×4 像素纯实心小方块拼出 10×16 宽大井区（160 格可玩空间），左右配窄边框，右侧 HUD 实时显示 NEXT 预览、LINE 消行数与 PLAY/OVER 状态',
    '7 种经典 Tetromino 各配专属 256 色（I青/O黄/T紫/L橙/J蓝/S绿/Z红），下落与落地锁定均保持干净纯实心显示',
    'KEY2(A/←) 左移、KEY3(D/→) 右移、KEY0(W/↑) 顺时针旋转（支持靠墙 1~3 格踢墙）、KEY1(S/↓) 加速软降，SW0 开启高速模式',
    '内置零闪烁差分渲染器，每拍自动优先刷新变化格，触底锁定后自动检测 10 格满行消除、上层下移并累加 BCD 分数与提示音',
    '新方块出生位被阻挡时进入 GAME OVER（红灯 + 红色 OVER），按 RST (R) 立即重开',
  ],
  pinMappings: [
    { port: 'key[0]', role: '顺时针旋转（W / ↑，含靠墙踢墙）' },
    { port: 'key[1]', role: '加速软降（S / ↓）' },
    { port: 'key[2]', role: '向左平移（A / ←）' },
    { port: 'key[3]', role: '向右平移（D / →）' },
    { port: 'sw[0]', role: '高速下落开关（1=双倍重力）' },
    { port: 'rst_n', role: '硬件复位 / 重新开始（R）' },
    { port: 'screen_x/y/data/cmd/color', role: '16×8 256 色 OLED 彩色显存写入与清屏端口（2×2 实心象限子块）' },
    { port: 'seg[15:0]', role: '高 2 位得分 / 低 2 位消行数（BCD）' },
    { port: 'tone[3:0]', role: '平移、旋转、锁定、消行与结束音效' },
  ],
  mermaidFsm: `stateDiagram-v2
    [*] --> ST_PLAY
    ST_PLAY --> ST_PLAY: 平移 / 旋转 / 软降 / 重力下落
    ST_PLAY --> ST_CLEAR: 触底锁定 4 格
    ST_CLEAR --> ST_CLEAR: 检测到 10 格满行 -> 消行下移计分
    ST_CLEAR --> ST_PLAY: 生成下一个彩色方块
    ST_CLEAR --> ST_OVER: 出生位碰撞
    ST_OVER --> ST_PLAY: rst_n=0 复位重开`,
};

// ============================================================
// 256 色 RGB 立方渐变秀（6×6×6 RGB 色立方 16..231 + 4 种可切换视觉模式）
// ============================================================

export const RGB_CUBE_CODE = `module top (
    input            clk,
    input            rst_n,
    input      [3:0] key,
    input      [7:0] sw,
    output     [7:0] led,
    output     [2:0] traffic,
    output    [15:0] seg,
    output reg [3:0] screen_x,
    output reg [2:0] screen_y,
    output reg [7:0] screen_data,
    output reg [1:0] screen_cmd,
    output reg [7:0] screen_color
);
    localparam TILE_SOLID = 8'h80;
    localparam TILE_CHECK = 8'h90;
    localparam TILE_CAP   = 8'h91;

    reg [6:0] scan;       // 0..127 全屏逐格扫描索引
    reg [5:0] phase;      // 动画相位（每帧递增，也可按键手动步进）
    reg [3:0] hue_shift;  // 色相偏移（KEY1 切换）
    reg       paused;     // 暂停标记（KEY0 切换）
    reg [3:0] prev_key;
    reg [7:0] last_color;

    wire [1:0] mode  = sw[1:0];
    wire [3:0] cur_x = scan[3:0];
    wire [2:0] cur_y = scan[6:4];

    wire key_pause = key[0] && !prev_key[0];
    wire key_hue   = key[1] && !prev_key[1];
    wire key_prev  = key[2] && !prev_key[2];
    wire key_next  = key[3] && !prev_key[3];

    // 16 阶无缝对称三角波 LUT（0..15 -> 0..5，用于平滑遍历 6×6×6 RGB 色立方）
    reg [3:0] r_ang, g_ang, b_ang;
    reg [2:0] r_lvl, g_lvl, b_lvl;
    reg [2:0] bar_h;
    reg [7:0] next_data;
    reg [7:0] next_color;

    wire [3:0] wave_idx = cur_x + phase[3:0];
    wire [3:0] diag_a   = cur_x + {1'b0, cur_y} + phase[3:0] + hue_shift;
    wire [3:0] diag_b   = cur_x - {1'b0, cur_y} + phase[3:0];

    always @(*) begin
        // 默认角度：按模式构造 RGB 三通道相位
        if (mode == 2'b00) begin
            // 模式 0：RGB 立方渐变流（横向色相 + 纵向绿蓝过渡）
            r_ang = cur_x + phase[3:0] + hue_shift;
            g_ang = {cur_y, 1'b0} + phase[3:0] + 4'd5;
            b_ang = (4'd15 - cur_x) + {1'b0, cur_y} + phase[3:0] + 4'd11;
        end else if (mode == 2'b01) begin
            // 模式 1：彩虹频谱柱（每列专属彩虹色相）
            r_ang = cur_x + hue_shift;
            g_ang = cur_x + hue_shift + 4'd5;
            b_ang = cur_x + hue_shift + 4'd11;
        end else begin
            // 模式 2：霓虹等离子涟漪（二维斜波干涉）
            r_ang = diag_a;
            g_ang = diag_b + 4'd5;
            b_ang = diag_a + diag_b + 4'd10;
        end

        case (r_ang)
            4'd0:  r_lvl = 3'd0; 4'd1:  r_lvl = 3'd1; 4'd2:  r_lvl = 3'd1; 4'd3:  r_lvl = 3'd2;
            4'd4:  r_lvl = 3'd3; 4'd5:  r_lvl = 3'd4; 4'd6:  r_lvl = 3'd5; 4'd7:  r_lvl = 3'd5;
            4'd8:  r_lvl = 3'd5; 4'd9:  r_lvl = 3'd5; 4'd10: r_lvl = 3'd4; 4'd11: r_lvl = 3'd3;
            4'd12: r_lvl = 3'd2; 4'd13: r_lvl = 3'd1; 4'd14: r_lvl = 3'd1; default: r_lvl = 3'd0;
        endcase
        case (g_ang)
            4'd0:  g_lvl = 3'd0; 4'd1:  g_lvl = 3'd1; 4'd2:  g_lvl = 3'd1; 4'd3:  g_lvl = 3'd2;
            4'd4:  g_lvl = 3'd3; 4'd5:  g_lvl = 3'd4; 4'd6:  g_lvl = 3'd5; 4'd7:  g_lvl = 3'd5;
            4'd8:  g_lvl = 3'd5; 4'd9:  g_lvl = 3'd5; 4'd10: g_lvl = 3'd4; 4'd11: g_lvl = 3'd3;
            4'd12: g_lvl = 3'd2; 4'd13: g_lvl = 3'd1; 4'd14: g_lvl = 3'd1; default: g_lvl = 3'd0;
        endcase
        case (b_ang)
            4'd0:  b_lvl = 3'd0; 4'd1:  b_lvl = 3'd1; 4'd2:  b_lvl = 3'd1; 4'd3:  b_lvl = 3'd2;
            4'd4:  b_lvl = 3'd3; 4'd5:  b_lvl = 3'd4; 4'd6:  b_lvl = 3'd5; 4'd7:  b_lvl = 3'd5;
            4'd8:  b_lvl = 3'd5; 4'd9:  b_lvl = 3'd5; 4'd10: b_lvl = 3'd4; 4'd11: b_lvl = 3'd3;
            4'd12: b_lvl = 3'd2; 4'd13: b_lvl = 3'd1; 4'd14: b_lvl = 3'd1; default: b_lvl = 3'd0;
        endcase

        case (wave_idx)
            4'd0:  bar_h = 3'd2; 4'd1:  bar_h = 3'd3; 4'd2:  bar_h = 3'd5; 4'd3:  bar_h = 3'd6;
            4'd4:  bar_h = 3'd7; 4'd5:  bar_h = 3'd6; 4'd6:  bar_h = 3'd5; 4'd7:  bar_h = 3'd3;
            4'd8:  bar_h = 3'd2; 4'd9:  bar_h = 3'd1; 4'd10: bar_h = 3'd2; 4'd11: bar_h = 3'd4;
            4'd12: bar_h = 3'd6; 4'd13: bar_h = 3'd5; 4'd14: bar_h = 3'd4; default: bar_h = 3'd3;
        endcase

        // RGB 色立方索引：16 + 36*r + 6*g + b（范围 16..231）
        next_color = 8'd16 + ({5'd0, r_lvl} * 8'd36) + ({5'd0, g_lvl} * 8'd6) + {5'd0, b_lvl};
        next_data  = TILE_SOLID;

        if (mode == 2'b01) begin
            if ((3'd7 - cur_y) < bar_h) begin
                next_data = TILE_SOLID;
            end else if ((3'd7 - cur_y) == bar_h) begin
                next_data  = TILE_CAP;
                next_color = 8'd231; // 亮白波峰帽
            end else begin
                next_data  = 8'h00;
                next_color = 8'd0;
            end
        end else if (mode == 2'b10) begin
            next_data = (diag_a[1] ^ diag_b[1]) ? TILE_SOLID : TILE_CHECK;
        end else if (mode == 2'b11) begin
            // 模式 3：256 全色板巡检（SW2=0 展示 0..127，SW2=1 展示 128..255）
            next_data  = TILE_SOLID;
            next_color = {sw[2], cur_y, cur_x};
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            scan         <= 7'd0;
            phase        <= 6'd0;
            hue_shift    <= 4'd0;
            paused       <= 1'b0;
            prev_key     <= 4'd0;
            last_color   <= 8'd0;
            screen_x     <= 4'd0;
            screen_y     <= 3'd0;
            screen_data  <= 8'h00;
            screen_color <= 8'd0;
            screen_cmd   <= 2'b10;
        end else begin
            prev_key <= key;
            if (key_pause) paused    <= !paused;
            if (key_hue)   hue_shift <= hue_shift + 4'd2;

            screen_x     <= cur_x;
            screen_y     <= cur_y;
            screen_data  <= next_data;
            screen_color <= next_color;
            screen_cmd   <= 2'b01;
            last_color   <= next_color;

            if (key_next) begin
                phase <= phase + 6'd1;
            end else if (key_prev) begin
                phase <= phase - 6'd1;
            end else if ((scan == 7'd127) && !paused) begin
                phase <= phase + 6'd1;
            end

            scan <= scan + 7'd1;
        end
    end

    wire [3:0] mode_onehot = (mode == 2'b00) ? 4'b0001 :
                             (mode == 2'b01) ? 4'b0010 :
                             (mode == 2'b10) ? 4'b0100 : 4'b1000;

    assign led     = {phase[3:0], mode_onehot};
    assign traffic = paused ? 3'b010 : 3'b001;
    assign seg     = {{2'b00, mode}, phase[3:0], last_color};
endmodule
`;

const RGB_CUBE_VECTORS: TestVectorStep[] = [
  {
    cycle: 0,
    inputs: { rst_n: 0, key: 0, sw: 0 },
    expect: { led: 1, seg: 0, traffic: 1 },
    expectScreen: [{ x: 0, y: 0, code: 0x00 }],
    note: '复位清屏并回到模式 0（RGB 立方渐变流）',
  },
  { cycle: 1, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 0, y: 0, code: 0x80 }], note: '写入 (0,0) RGB 色立方像素' },
  { cycle: 2, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 1, y: 0, code: 0x80 }], note: '写入 (1,0) 渐变像素' },
  { cycle: 3, inputs: { rst_n: 1, key: 0, sw: 0 }, expectScreen: [{ x: 2, y: 0, code: 0x80 }], note: '写入 (2,0) 渐变像素' },
  { cycle: 4, inputs: { rst_n: 1, key: 0, sw: 3 }, expect: { led: 8 }, expectScreen: [{ x: 3, y: 0, code: 0x80 }], note: '切至模式 3（SW[1:0]=11 全 256 色板巡检），LED3 亮起' },
  { cycle: 5, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { traffic: 2 }, note: '按下 KEY0 暂停相位推进，交通灯切黄灯' },
  { cycle: 6, inputs: { rst_n: 1, key: 0, sw: 1 }, expect: { led: 2, traffic: 2 }, note: '切至模式 1（彩虹频谱柱）并保持暂停状态' },
  { cycle: 7, inputs: { rst_n: 1, key: 1, sw: 2 }, expect: { led: 4, traffic: 1 }, note: '再次按 KEY0 恢复动画并切至模式 2（霓虹等离子涟漪）' },
];

const RGB_CUBE_BLUEPRINT: PresetProject['blueprint'] = {
  title: '256 色 RGB 立方渐变秀',
  summary: '充分发挥 16×8 256 色 OLED 的 6×6×6 RGB 色立方（色号 16–231）表现力，支持 SW[1:0] 实时切换 4 种动态渐变视觉与 256 全色板巡检。',
  behaviors: [
    '模式 0（SW[1:0]=00）：RGB 立方渐变流，基于无缝 16 阶三角波查表计算 16 + 36r + 6g + b，全屏呈现丝滑二维彩虹渐变',
    '模式 1（SW[1:0]=01）：彩虹频谱柱，16 列独立彩色频谱随相位波动并带亮白波峰帽',
    '模式 2（SW[1:0]=10）：霓虹等离子涟漪，二维斜波干涉叠加实心与网格图块产生霓虹流动感',
    '模式 3（SW[1:0]=11）：全 256 色板巡检，用 SW2 切换第 0 页（0–127）与第 1 页（128–255）同屏检阅全部 256 色',
    'KEY0 启停相位动画、KEY1 偏移色相、KEY2/KEY3 手动前后步进；数码管实时显示模式、相位与当前 2 位十六进制色号',
  ],
  pinMappings: [
    { port: 'sw[1:0]', role: '4 种视觉模式切换（00 立方渐变 / 01 彩虹频谱 / 10 霓虹涟漪 / 11 全色板）' },
    { port: 'sw[2]', role: '全色板模式翻页（0=色号 0–127，1=色号 128–255）' },
    { port: 'key[0]', role: '暂停 / 恢复动画相位（W / ↑）' },
    { port: 'key[1]', role: '切换色相偏移（S / ↓）' },
    { port: 'key[2]', role: '相位后退一步（A / ←）' },
    { port: 'key[3]', role: '相位前进一步（D / →）' },
    { port: 'screen_x/y/data/cmd/color', role: '16×8 256 色 OLED 扫描与 RGB 色立方着色端口' },
    { port: 'seg[15:0]', role: '模式号 + 相位 + 当前写入色号（Hex）' },
  ],
  mermaidFsm: `stateDiagram-v2
    [*] --> MODE_CUBE
    MODE_CUBE --> MODE_SPECTRUM: sw[1:0]=01
    MODE_SPECTRUM --> MODE_PLASMA: sw[1:0]=10
    MODE_PLASMA --> MODE_SWATCH: sw[1:0]=11
    MODE_SWATCH --> MODE_CUBE: sw[1:0]=00`,
};

export const PRESETS: PresetProject[] = [
  {
    ...MOCK_PRESETS[0],
    category: '状态机与定时',
    difficulty: 'beginner',
    boardHint: 'traffic',
  },
  {
    id: 'sequence-detector',
    name: '1011 序列检测器',
    prompt: '用 KEY0 作为串行数据输入，检测 1011 序列，检测成功时 LED0 亮一拍，支持重叠检测',
    blueprint: SEQUENCE_DETECTOR_BLUEPRINT,
    verilogCode: SEQUENCE_DETECTOR_CODE,
    testVectors: SEQUENCE_DETECTOR_VECTORS,
    bugs: makeSequenceDetectorBugs(SEQUENCE_DETECTOR_CODE),
    category: '序列检测',
    difficulty: 'beginner',
    boardHint: 'general',
  },
  {
    id: 'stopwatch',
    name: '数字秒表',
    prompt: '做一个 4 位 BCD 数字秒表，KEY0 启停，KEY1 清零，数码管显示 0000 到 9999',
    blueprint: STOPWATCH_BLUEPRINT,
    verilogCode: STOPWATCH_CODE,
    testVectors: STOPWATCH_VECTORS,
    bugs: makeStopwatchBugs(STOPWATCH_CODE),
    category: '计数器',
    difficulty: 'intermediate',
    boardHint: 'counter',
  },
  {
    id: 'buzzer',
    name: '四人抢答器',
    prompt: '做一个四人抢答器，四位选手各按一个按键，先按下者锁定，LED0-3 指示获胜者，复位后重新开始',
    blueprint: BUZZER_BLUEPRINT,
    verilogCode: BUZZER_CODE,
    testVectors: BUZZER_VECTORS,
    bugs: makeBuzzerBugs(BUZZER_CODE),
    category: '状态机与仲裁',
    difficulty: 'intermediate',
    boardHint: 'general',
  },
  {
    id: 'snake',
    name: '彩色 OLED 贪吃蛇',
    prompt: '在 16×8 256 色 OLED 屏幕上做一个彩色贪吃蛇游戏，用 KEY0-KEY3（WASD / 方向键）控制上下左右移动，吃食物变长并记分，撞墙显示 GAME OVER',
    blueprint: SNAKE_BLUEPRINT,
    verilogCode: SNAKE_CODE,
    testVectors: SNAKE_VECTORS,
    bugs: makeSnakeBugs(SNAKE_CODE),
    category: '256 色游戏',
    difficulty: 'intermediate',
    boardHint: 'general',
    boardProfileId: 'arcade',
    requiredPeripherals: ['led', 'seg', 'screen', 'tone'],
    recommendedClockSpeed: 'fast',
  },
  {
    id: 'tetris',
    name: '彩色俄罗斯方块',
    prompt: '在 16×8 256 色 OLED 屏幕上做一个彩色俄罗斯方块游戏：7 种经典彩色方块、WASD/方向键控制左右移动、旋转踢墙和加速下落，支持满行消除、NEXT 彩色预览与数码管计分',
    blueprint: TETRIS_BLUEPRINT,
    verilogCode: TETRIS_CODE,
    testVectors: TETRIS_VECTORS,
    bugs: makeTetrisBugs(TETRIS_CODE),
    category: '256 色游戏',
    difficulty: 'advanced',
    boardHint: 'general',
    boardProfileId: 'arcade',
    requiredPeripherals: ['led', 'seg', 'screen', 'tone'],
    recommendedClockSpeed: 'turbo',
  },
  {
    id: 'rgb-cube',
    name: '256 色 RGB 立方渐变秀',
    prompt: '在 16×8 256 色 OLED 屏幕上做一个 256 色 RGB 立方渐变视觉演示，用 SW[1:0] 切换 RGB 立方渐变流、彩虹频谱柱、霓虹等离子涟漪与全 256 色板巡检，按键可控制暂停、色相偏移与手动步进',
    blueprint: RGB_CUBE_BLUEPRINT,
    verilogCode: RGB_CUBE_CODE,
    testVectors: RGB_CUBE_VECTORS,
    bugs: makeRgbCubeBugs(RGB_CUBE_CODE),
    category: '256 色视觉',
    difficulty: 'beginner',
    boardHint: 'general',
    boardProfileId: 'display',
    requiredPeripherals: ['led', 'seg', 'screen'],
    recommendedClockSpeed: 'turbo',
  },
];